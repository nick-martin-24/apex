import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getDailyRecommendation } from "@/lib/recommendation";

export const dynamic = "force-dynamic";

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const [{ rows: recoveryRows }, { rows: workoutRows }] = await Promise.all([
    pool.query("select recovery_score from recovery_days where date = $1", [today]),
    pool.query(
      `select pw.title, pw.structure from planned_workouts pw
       join plans p on p.id = pw.plan_id
       where p.status = 'active' and pw.scheduled_date = $1
       limit 1`,
      [today]
    ),
  ]);

  if (recoveryRows.length === 0) {
    return NextResponse.json(
      { error: "No WHOOP recovery data for today yet — sync your WHOOP app or check back later" },
      { status: 404 }
    );
  }

  const recoveryScore = Number(recoveryRows[0].recovery_score);
  const plannedWorkout = workoutRows[0] ?? null;

  const recommendation = getDailyRecommendation(recoveryScore, plannedWorkout);

  return NextResponse.json({ date: today, ...recommendation });
}
