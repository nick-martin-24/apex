import { pool } from "./db";
import { computeCompliance, assessCompliance } from "./compliance";
import { previewSwap, previewMove, previewAdd, SwapType, AddableType } from "./planAdjustment";

interface RecentWorkoutSummary {
  date: string;
  title: string;
  targetTss: number;
  actualTss: number | null;
  durationCompliancePct: number;
  intervalsAchieved: string | null; // "3/4" or null if not interval-based
  band: "green" | "yellow" | "red";
}

interface UpcomingWorkout {
  id: number;
  date: string;
  title: string;
  targetDurationMin: number;
  targetTss: number;
}

interface CoachContext {
  planId: number | null;
  today: string;
  ftpWatts: number | null;
  plan: {
    type: string;
    startDate: string;
    durationWeeks: number;
    keyWorkoutsPerWeek: number;
    targetWeeklyHours: number;
  } | null;
  recentWorkouts: RecentWorkoutSummary[];
  recoveryTrend: Array<{ date: string; recoveryScore: number; hrvMs: number | null }>;
  upcomingWorkouts: UpcomingWorkout[];
}

async function gatherCoachContext(): Promise<CoachContext> {
  const { rows: settingsRows } = await pool.query("select ftp_watts from athlete_settings where id = true");
  const ftpWatts = settingsRows[0]?.ftp_watts ?? null;

  const { rows: planRows } = await pool.query(
    "select * from plans where status = 'active' order by created_at desc limit 1"
  );
  const activePlan = planRows[0] ?? null;

  const today = new Date().toISOString().slice(0, 10);
  let recentWorkouts: RecentWorkoutSummary[] = [];
  let upcomingWorkouts: UpcomingWorkout[] = [];

  if (activePlan) {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const startWindow = fourteenDaysAgo.toISOString().slice(0, 10);
    const sevenDaysAhead = new Date();
    sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);
    const endWindow = sevenDaysAhead.toISOString().slice(0, 10);

    const { rows: recentRows } = await pool.query(
      `select * from planned_workouts
       where plan_id = $1 and scheduled_date between $2 and $3 and completed_activity_id is not null
       order by scheduled_date asc`,
      [activePlan.id, startWindow, today]
    );

    for (const workout of recentRows) {
      const [{ rows: activityRows }, { rows: streamRows }] = await Promise.all([
        pool.query("select * from activities where id = $1", [workout.completed_activity_id]),
        pool.query("select time_s, watts from activity_streams where activity_id = $1", [workout.completed_activity_id]),
      ]);
      const activity = activityRows[0];
      if (!activity) continue;
      const stream = streamRows[0] ?? null;

      const result = computeCompliance(
        { target_duration_min: workout.target_duration_min, structure: workout.structure },
        { moving_time_s: activity.moving_time_s, avg_watts: activity.avg_watts, weighted_avg_watts: activity.weighted_avg_watts },
        stream,
        ftpWatts
      );
      const assessment = assessCompliance(result);

      recentWorkouts.push({
        date: workout.scheduled_date.toISOString().slice(0, 10),
        title: workout.title,
        targetTss: result.tss.targetTss,
        actualTss: result.tss.actualTss,
        durationCompliancePct: result.duration.compliancePct,
        intervalsAchieved: result.intervals ? `${result.intervals.achievedReps}/${result.intervals.targetReps}` : null,
        band: assessment.band,
      });
    }

    const { rows: upcomingRows } = await pool.query(
      `select * from planned_workouts
       where plan_id = $1 and scheduled_date between $2 and $3
       order by scheduled_date asc`,
      [activePlan.id, today, endWindow]
    );
    upcomingWorkouts = upcomingRows.map((w: any) => ({
      id: w.id,
      date: w.scheduled_date.toISOString().slice(0, 10),
      title: w.title,
      targetDurationMin: w.target_duration_min,
      targetTss: w.target_tss,
    }));
  }

  const { rows: recoveryRows } = await pool.query("select * from recovery_days order by date desc limit 7");
  const recoveryTrend = recoveryRows
    .map((r: any) => ({
      date: r.date.toISOString().slice(0, 10),
      recoveryScore: Number(r.recovery_score),
      hrvMs: r.hrv_ms != null ? Math.round(r.hrv_ms) : null,
    }))
    .reverse(); // oldest first, easier to read as a trend

  return {
    planId: activePlan?.id ?? null,
    today,
    ftpWatts,
    plan: activePlan
      ? {
          type: activePlan.type,
          startDate: activePlan.start_date.toISOString().slice(0, 10),
          durationWeeks: activePlan.duration_weeks,
          keyWorkoutsPerWeek: activePlan.key_workouts_per_week,
          targetWeeklyHours: Number(activePlan.target_weekly_hours),
        }
      : null,
    recentWorkouts,
    recoveryTrend,
    upcomingWorkouts,
  };
}

function formatContextForPrompt(ctx: CoachContext): string {
  const lines: string[] = [];

  lines.push(`Today's date: ${ctx.today}`);
  lines.push(`Athlete FTP: ${ctx.ftpWatts ?? "not set"} watts`);

  if (ctx.plan) {
    lines.push(
      `Active plan: ${ctx.plan.type}, started ${ctx.plan.startDate}, ${ctx.plan.durationWeeks} weeks, ${ctx.plan.keyWorkoutsPerWeek} key workouts/week, ${ctx.plan.targetWeeklyHours}h/week target.`
    );
  } else {
    lines.push("No active plan.");
  }

  lines.push("");
  lines.push("Recent completed workouts (last 14 days, planned vs actual):");
  if (ctx.recentWorkouts.length === 0) {
    lines.push("(none completed/linked in this window)");
  } else {
    for (const w of ctx.recentWorkouts) {
      lines.push(
        `- ${w.date} "${w.title}": target ${w.targetTss} TSS, actual ${w.actualTss ?? "unknown"} TSS, duration ${w.durationCompliancePct}% of plan${w.intervalsAchieved ? `, intervals ${w.intervalsAchieved} achieved` : ""} — assessed ${w.band}`
      );
    }
  }

  lines.push("");
  lines.push("Recovery trend (last 7 days, oldest to most recent):");
  if (ctx.recoveryTrend.length === 0) {
    lines.push("(no WHOOP recovery data available)");
  } else {
    for (const r of ctx.recoveryTrend) {
      lines.push(`- ${r.date}: recovery ${r.recoveryScore}%${r.hrvMs != null ? `, HRV ${r.hrvMs}ms` : ""}`);
    }
  }

  lines.push("");
  lines.push("Upcoming planned workouts (next 7 days, with their workout_id for tool calls):");
  if (ctx.upcomingWorkouts.length === 0) {
    lines.push("(none scheduled)");
  } else {
    for (const w of ctx.upcomingWorkouts) {
      lines.push(`- id=${w.id} ${w.date} "${w.title}": ${w.targetDurationMin}min, ~${w.targetTss} TSS`);
    }
  }

  return lines.join("\n");
}

const TOOLS = [
  {
    name: "preview_swap",
    description:
      "Preview the impact of replacing an existing planned workout's type/content (e.g. turning a VO2max session into an easier endurance ride). Does not change anything — read-only.",
    input_schema: {
      type: "object",
      properties: {
        workout_id: { type: "integer", description: "id of the existing planned workout, from the upcoming workouts list" },
        workout_type: {
          type: "string",
          enum: ["recovery", "endurance", "group_ride", "tempo", "sweetspot", "threshold", "vo2max", "sprints"],
        },
        reps: { type: "integer", description: "for interval types only" },
        on_min: { type: "number", description: "minutes per interval, for interval types only" },
        minutes: { type: "number", description: "total ride minutes, for steady types (endurance/tempo/group_ride)" },
      },
      required: ["workout_id", "workout_type"],
    },
  },
  {
    name: "preview_move",
    description:
      "Preview the impact of rescheduling an existing planned workout to a different date. If that date already has a workout, they swap places. Does not change anything — read-only.",
    input_schema: {
      type: "object",
      properties: {
        workout_id: { type: "integer" },
        new_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["workout_id", "new_date"],
    },
  },
  {
    name: "preview_add",
    description:
      "Preview the impact of adding a brand-new easy ride (recovery/endurance/group_ride only) to a date that currently has no planned workout. Does not change anything — read-only.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, must be a rest day with no existing workout" },
        workout_type: { type: "string", enum: ["recovery", "endurance", "group_ride"] },
        minutes: { type: "number" },
      },
      required: ["date", "workout_type"],
    },
  },
];

async function executeTool(name: string, input: any, planId: number | null): Promise<any> {
  if (name === "preview_swap") {
    return previewSwap(input.workout_id, input.workout_type as SwapType, {
      reps: input.reps,
      onMin: input.on_min,
      minutes: input.minutes,
    });
  }
  if (name === "preview_move") {
    return previewMove(input.workout_id, input.new_date);
  }
  if (name === "preview_add") {
    if (!planId) return { error: "No active plan" };
    return previewAdd(planId, input.date, input.workout_type as AddableType, { minutes: input.minutes });
  }
  return { error: `Unknown tool ${name}` };
}

const SYSTEM_PROMPT = `You are an experienced, pragmatic cycling coach reviewing one specific athlete's real training data. You are not talking to a hypothetical athlete — every number below is real.

You have tools to preview the impact of a specific change (swapping a workout's type, moving it to another day, or adding an easy ride to a rest day) — these are read-only, they don't change anything. If you're considering recommending a concrete change, call the relevant preview tool FIRST to check it's actually a good idea (e.g. don't recommend a swap that would spike this week's TSS, or land a hard session next to another hard session — the tool will tell you). If the preview comes back with overall "not_recommended", don't propose it; either drop the idea or think of a better one.

Give a concise check-in: 3-5 short paragraphs, plain language, no headers or bullet lists. Cover:
1. What's going well and what's not, citing specific dates, workout names, and numbers from the data given.
2. Any pattern worth flagging — consistently under-hitting intervals, recovery trending down, TSS creeping over or under target, etc.
3. A specific, actionable recommendation for the next few days if one is warranted, described in plain language.
4. If everything looks solid, say so plainly — don't manufacture concern where there isn't any.

Be direct and specific, not generic filler. Do not add disclaimers about not being a real coach — just coach them.

If — and only if — you end up recommending one specific concrete change that you've validated with a preview tool and the preview was "recommended" or "caution" (not "not_recommended"), end your response with a single fenced block exactly like this, using the real parameters from your tool call:

\`\`\`action
{"action":"swap","workout_id":123,"workout_type":"endurance","minutes":75}
\`\`\`

(or "move" with workout_id + new_date, or "add" with date + workout_type + minutes). Omit this block entirely if you're not recommending one specific validated change — most check-ins won't need one.`;

function extractAction(text: string): { prose: string; action: any | null } {
  const match = text.match(/```action\s*([\s\S]*?)```/);
  if (!match) return { prose: text.trim(), action: null };

  const prose = text.slice(0, match.index).trim();
  try {
    const action = JSON.parse(match[1].trim());
    return { prose, action };
  } catch {
    return { prose, action: null };
  }
}

export async function getCoachCheckin(): Promise<{
  checkin: string;
  proposedAction: any | null;
  actionPreview: any | null;
  generatedAt: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to your Vercel environment variables");
  }

  const context = await gatherCoachContext();
  const contextText = formatContextForPrompt(context);

  const messages: any[] = [{ role: "user", content: contextText }];
  let lastPreview: any = null;

  // Tool-use loop: Claude may call preview tools a few times before its final answer.
  for (let i = 0; i < 4; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error: ${text}`);
    }

    const data = await res.json();

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });
      const toolResults = [];
      for (const block of data.content) {
        if (block.type === "tool_use") {
          const result = await executeTool(block.name, block.input, context.planId);
          if (!result.error) lastPreview = result;
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue; // let Claude see the tool results and continue
    }

    // Final answer
    const text = data.content?.map((b: any) => b.text ?? "").join("") ?? "";
    const { prose, action } = extractAction(text);

    return {
      checkin: prose,
      proposedAction: action,
      actionPreview: action ? lastPreview : null,
      generatedAt: new Date().toISOString(),
    };
  }

  throw new Error("Coach didn't reach a final answer after several tool calls");
}
