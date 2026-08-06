import { pool } from "./db";
import { computeCompliance, assessCompliance } from "./compliance";

interface RecentWorkoutSummary {
  date: string;
  title: string;
  targetTss: number;
  actualTss: number | null;
  durationCompliancePct: number;
  intervalsAchieved: string | null; // "3/4" or null if not interval-based
  band: "green" | "yellow" | "red";
}

interface CoachContext {
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
  upcomingWorkouts: Array<{ date: string; title: string; targetDurationMin: number; targetTss: number }>;
}

async function gatherCoachContext(): Promise<CoachContext> {
  const { rows: settingsRows } = await pool.query("select ftp_watts from athlete_settings where id = true");
  const ftpWatts = settingsRows[0]?.ftp_watts ?? null;

  const { rows: planRows } = await pool.query(
    "select * from plans where status = 'active' order by created_at desc limit 1"
  );
  const activePlan = planRows[0] ?? null;

  let recentWorkouts: RecentWorkoutSummary[] = [];
  let upcomingWorkouts: CoachContext["upcomingWorkouts"] = [];

  if (activePlan) {
    const today = new Date().toISOString().slice(0, 10);
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
      date: w.scheduled_date.toISOString().slice(0, 10),
      title: w.title,
      targetDurationMin: w.target_duration_min,
      targetTss: w.target_tss,
    }));
  }

  const { rows: recoveryRows } = await pool.query(
    "select * from recovery_days order by date desc limit 7"
  );
  const recoveryTrend = recoveryRows
    .map((r: any) => ({
      date: r.date.toISOString().slice(0, 10),
      recoveryScore: Number(r.recovery_score),
      hrvMs: r.hrv_ms != null ? Math.round(r.hrv_ms) : null,
    }))
    .reverse(); // oldest first, easier to read as a trend

  return {
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
  lines.push("Upcoming planned workouts (next 7 days):");
  if (ctx.upcomingWorkouts.length === 0) {
    lines.push("(none scheduled)");
  } else {
    for (const w of ctx.upcomingWorkouts) {
      lines.push(`- ${w.date} "${w.title}": ${w.targetDurationMin}min, ~${w.targetTss} TSS`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are an experienced, pragmatic cycling coach reviewing one specific athlete's real training data. You are not talking to a hypothetical athlete — every number below is real.

Give a concise check-in: 3-5 short paragraphs, plain language, no headers or bullet lists. Cover:
1. What's going well and what's not, citing specific dates, workout names, and numbers from the data given.
2. Any pattern worth flagging — consistently under-hitting intervals, recovery trending down, TSS creeping over or under target, etc.
3. A specific, actionable recommendation for the next few days if one is warranted. Reference actual upcoming workout titles/dates from the data. If a change seems warranted, describe it concretely (e.g. "consider swapping Thursday's VO2max session for an easier endurance ride" or "worth pushing Tuesday's threshold work a little harder given how well the last two sessions went").
4. If everything looks solid, say so plainly — don't manufacture concern where there isn't any.

Be direct and specific, not generic filler. Do not add disclaimers about not being a real coach or suggesting they consult a professional — just coach them.`;

export async function getCoachCheckin(): Promise<{ checkin: string; generatedAt: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to your Vercel environment variables");
  }

  const context = await gatherCoachContext();
  const contextText = formatContextForPrompt(context);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: contextText }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error: ${text}`);
  }

  const data = await res.json();
  const checkin = data.content?.map((b: any) => b.text ?? "").join("") ?? "";

  return { checkin, generatedAt: new Date().toISOString() };
}
