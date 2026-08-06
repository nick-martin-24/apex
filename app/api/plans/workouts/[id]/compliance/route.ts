import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { computeCompliance, assessCompliance } from "@/lib/compliance";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { rows: workoutRows } = await pool.query(
    "select * from planned_workouts where id = $1",
    [params.id]
  );
  const workout = workoutRows[0];
  if (!workout) {
    return NextResponse.json({ error: "Planned workout not found" }, { status: 404 });
  }
  if (!workout.completed_activity_id) {
    return NextResponse.json({ error: "This workout has no linked ride yet" }, { status: 404 });
  }

  const [{ rows: activityRows }, { rows: streamRows }, { rows: settingsRows }] = await Promise.all([
    pool.query("select * from activities where id = $1", [workout.completed_activity_id]),
    pool.query("select time_s, watts from activity_streams where activity_id = $1", [
      workout.completed_activity_id,
    ]),
    pool.query("select ftp_watts from athlete_settings where id = true"),
  ]);

  const activity = activityRows[0];
  if (!activity) {
    return NextResponse.json({ error: "Linked activity not found" }, { status: 404 });
  }

  const ftp = settingsRows[0]?.ftp_watts ?? null;
  const stream = streamRows[0] ?? null;

  const result = computeCompliance(
    { target_duration_min: workout.target_duration_min, structure: workout.structure },
    { moving_time_s: activity.moving_time_s, avg_watts: activity.avg_watts },
    stream,
    ftp
  );

  return NextResponse.json({
    workout: { id: workout.id, title: workout.title, scheduled_date: workout.scheduled_date },
    activity: { id: activity.id, name: activity.name },
    ftp_watts: ftp,
    ...result,
    assessment: assessCompliance(result),
  });
}
