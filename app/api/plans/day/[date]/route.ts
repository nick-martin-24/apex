import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { computeCompliance, assessCompliance } from "@/lib/compliance";
import { getDailyRecommendation } from "@/lib/recommendation";
import { getEasternDateString } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  const { date } = params;
  const today = getEasternDateString();
  const isToday = date === today;

  const [{ rows: planRows }, { rows: recoveryRows }] = await Promise.all([
    pool.query("select * from plans where status = 'active' order by created_at desc limit 1"),
    pool.query("select * from recovery_days where date = $1", [date]),
  ]);
  const activePlan = planRows[0] ?? null;
  const recovery = recoveryRows[0] ?? null;

  let workout: any = null;
  let activity: any = null;
  let compliance: any = null;
  let assessment: any = null;
  let recommendation: any = null;

  if (activePlan) {
    const { rows } = await pool.query(
      "select * from planned_workouts where plan_id = $1 and scheduled_date = $2 limit 1",
      [activePlan.id, date]
    );
    workout = rows[0] ?? null;
  }

  if (workout?.completed_activity_id) {
    const [{ rows: activityRows }, { rows: streamRows }, { rows: settingsRows }] = await Promise.all([
      pool.query("select * from activities where id = $1", [workout.completed_activity_id]),
      pool.query("select time_s, watts from activity_streams where activity_id = $1", [
        workout.completed_activity_id,
      ]),
      pool.query("select ftp_watts from athlete_settings where id = true"),
    ]);
    activity = activityRows[0] ?? null;
    const ftp = settingsRows[0]?.ftp_watts ?? null;
    const stream = streamRows[0] ?? null;

    if (activity) {
      compliance = computeCompliance(
        { target_duration_min: workout.target_duration_min, structure: workout.structure },
        { moving_time_s: activity.moving_time_s, avg_watts: activity.avg_watts, weighted_avg_watts: activity.weighted_avg_watts },
        stream,
        ftp
      );
      assessment = assessCompliance(compliance);
    }
  }

  // Forward-looking recommendation only makes sense for the actual current day.
  if (isToday && recovery) {
    recommendation = getDailyRecommendation(Number(recovery.recovery_score), workout);
  }

  return NextResponse.json({ date, isToday, recovery, workout, activity, compliance, assessment, recommendation });
}
