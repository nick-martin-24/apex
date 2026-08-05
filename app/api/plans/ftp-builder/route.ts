import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { buildFtpBuilderTemplate, ALL_WORKOUT_TYPES, KeyWorkoutType } from "@/lib/planTemplates/ftpBuilder";

// POST {
//   "start_date": "2026-08-11", "duration_weeks": 10, "key_workouts_per_week": 2,
//   "target_weekly_hours": 6, "rides_per_week": 4,
//   "allowed_types": ["sweetspot","tempo","threshold","vo2max","sprints"]
// }
// start_date should be a Monday, keeps day_offset math simple.
// allowed_types is optional — omit or send [] to allow everything.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const startDate = body.start_date ? new Date(body.start_date) : null;
  const durationWeeks = Number(body.duration_weeks);
  const keyWorkoutsPerWeek = Number(body.key_workouts_per_week);
  const targetWeeklyHours = Number(body.target_weekly_hours);
  const ridesPerWeek = Number(body.rides_per_week ?? 4);
  const allowedTypesInput: string[] = Array.isArray(body.allowed_types) ? body.allowed_types : [];

  if (!startDate || isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "start_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!durationWeeks || durationWeeks < 2) {
    return NextResponse.json({ error: "duration_weeks must be at least 2" }, { status: 400 });
  }
  if (!keyWorkoutsPerWeek || keyWorkoutsPerWeek < 1 || keyWorkoutsPerWeek > 4) {
    return NextResponse.json({ error: "key_workouts_per_week must be between 1 and 4" }, { status: 400 });
  }
  if (!targetWeeklyHours || targetWeeklyHours < 2) {
    return NextResponse.json({ error: "target_weekly_hours must be at least 2" }, { status: 400 });
  }
  if (!ridesPerWeek || ridesPerWeek < keyWorkoutsPerWeek || ridesPerWeek > 7) {
    return NextResponse.json(
      { error: `rides_per_week must be between ${keyWorkoutsPerWeek} (your key workout count) and 7` },
      { status: 400 }
    );
  }
  const invalidTypes = allowedTypesInput.filter((t) => !ALL_WORKOUT_TYPES.includes(t as KeyWorkoutType));
  if (invalidTypes.length > 0) {
    return NextResponse.json({ error: `Unknown workout type(s): ${invalidTypes.join(", ")}` }, { status: 400 });
  }
  const allowedTypes = (allowedTypesInput.length > 0 ? allowedTypesInput : ALL_WORKOUT_TYPES) as KeyWorkoutType[];

  const weeks = buildFtpBuilderTemplate(durationWeeks, keyWorkoutsPerWeek, targetWeeklyHours, ridesPerWeek, allowedTypes);

  const { rows } = await pool.query(
    `insert into plans (type, start_date, duration_weeks, key_workouts_per_week, target_weekly_hours, rides_per_week, allowed_types, status)
     values ('ftp_builder', $1, $2, $3, $4, $5, $6, 'active') returning id`,
    [
      startDate.toISOString().slice(0, 10),
      durationWeeks,
      keyWorkoutsPerWeek,
      targetWeeklyHours,
      ridesPerWeek,
      JSON.stringify(allowedTypes),
    ]
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
