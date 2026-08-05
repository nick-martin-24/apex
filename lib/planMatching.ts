import { pool } from "./db";

// Looks for an active plan's workout scheduled on the same calendar date as
// the given ride, and links it if found and not already linked to something else.
export async function matchActivityToPlannedWorkout(activityId: string, activityStartDate: string) {
  const rideDate = activityStartDate.slice(0, 10); // YYYY-MM-DD, drop time component

  const { rows } = await pool.query(
    `select pw.id from planned_workouts pw
     join plans p on p.id = pw.plan_id
     where p.status = 'active'
       and pw.scheduled_date = $1
       and pw.completed_activity_id is null
     order by pw.id asc
     limit 1`,
    [rideDate]
  );

  if (rows.length === 0) return null;

  await pool.query(`update planned_workouts set completed_activity_id = $1 where id = $2`, [
    activityId,
    rows[0].id,
  ]);

  return rows[0].id as number;
}

// Bulk version: matches every unlinked planned workout in the active plan
// against any already-ingested activity on the same date. Useful after
// creating a plan retroactively, or if rides were backfilled before the
// plan existed.
export async function rematchAllForActivePlan(): Promise<number> {
  const { rows } = await pool.query(
    `select pw.id as workout_id, a.id as activity_id
     from planned_workouts pw
     join plans p on p.id = pw.plan_id
     join activities a on a.start_date::date = pw.scheduled_date
     where p.status = 'active' and pw.completed_activity_id is null`
  );

  for (const row of rows) {
    await pool.query(`update planned_workouts set completed_activity_id = $1 where id = $2`, [
      row.activity_id,
      row.workout_id,
    ]);
  }

  return rows.length;
}
