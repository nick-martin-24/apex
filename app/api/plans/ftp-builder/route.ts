import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { buildFtpBuilderTemplate } from "@/lib/planTemplates/ftpBuilder";

// POST { "start_date": "2026-08-11", "duration_weeks": 10, "key_workouts_per_week": 2 }
// start_date should be a Monday, keeps day_offset math simple.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const startDate = body.start_date ? new Date(body.start_date) : null;
  const durationWeeks = Number(body.duration_weeks);
  const keyWorkoutsPerWeek = Number(body.key_workouts_per_week);

  if (!startDate || isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "start_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!durationWeeks || durationWeeks < 2) {
    return NextResponse.json({ error: "duration_weeks must be at least 2" }, { status: 400 });
  }
  if (!keyWorkoutsPerWeek || keyWorkoutsPerWeek < 1 || keyWorkoutsPerWeek > 4) {
    return NextResponse.json({ error: "key_workouts_per_week must be between 1 and 4" }, { status: 400 });
  }

  const weeks = buildFtpBuilderTemplate(durationWeeks, keyWorkoutsPerWeek);

  const { rows } = await pool.query(
    `insert into plans (type, start_date, duration_weeks, key_workouts_per_week, status)
     values ('ftp_builder', $1, $2, $3, 'active') returning id`,
    [startDate.toISOString().slice(0, 10), durationWeeks, keyWorkoutsPerWeek]
  );
  const planId = rows[0].id;

  for (const week of weeks) {
    for (const workout of week.workouts) {
      const scheduledDate = new Date(startDate);
      scheduledDate.setDate(scheduledDate.getDate() + (week.weekNumber - 1) * 7 + workout.dayOffset);

      await pool.query(
        `insert into planned_workouts
           (plan_id, week_number, phase, day_offset, scheduled_date, title, description, target_duration_min, target_tss, structure)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          planId,
          week.weekNumber,
          week.phase,
          workout.dayOffset,
          scheduledDate.toISOString().slice(0, 10),
          workout.title,
          workout.description,
          workout.targetDurationMin,
          workout.targetTss,
          JSON.stringify(workout.structure),
        ]
      );
    }
  }

  return NextResponse.json({ plan_id: planId, weeks: weeks.length });
}
