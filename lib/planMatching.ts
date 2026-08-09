import { pool } from "./db";
import { getEasternDateString } from "./date";

// Looks for an active plan's workout scheduled on the same calendar date as
// the given ride, and links it if found and not already linked to something else.
export async function matchActivityToPlannedWorkout(activityId: string, activityStartDate: string) {
  // Strava's start_date is UTC — convert to Eastern before comparing, since
  // that's the timezone every planned_workout's scheduled_date is computed
  // in. A naive UTC slice can land on the wrong calendar date for rides near
  // the UTC day boundary (evening/early-morning Eastern).
  const rideDate = getEasternDateString(new Date(activityStartDate));

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
     join activities a on (a.start_date at time zone 'America/New_York')::date = pw.scheduled_date
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
