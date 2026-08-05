import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// This route queries the database directly and needs fresh data on every
// request — without this, Next.js can statically cache the response at
// build time (before any plan existed) and never re-check the database.
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows: planRows } = await pool.query(
    `select * from plans where status = 'active' order by created_at desc limit 1`
  );
  const plan = planRows[0];
  if (!plan) {
    return NextResponse.json({ error: "No active plan — POST /api/plans/ftp-builder to start one" }, { status: 404 });
  }

  const { rows: workouts } = await pool.query(
    `select * from planned_workouts where plan_id = $1 order by scheduled_date asc`,
    [plan.id]
  );

  const today = new Date().toISOString().slice(0, 10);
  const current = workouts.find((w) => w.scheduled_date.toISOString().slice(0, 10) === today);
  const thisWeek = current
    ? workouts.filter((w) => w.week_number === current.week_number)
    : workouts.filter((w) => new Date(w.scheduled_date) >= new Date(today)).slice(0, 4);

  return NextResponse.json({
    plan: { id: plan.id, type: plan.type, start_date: plan.start_date, status: plan.status },
    today: current ?? null,
    this_week: thisWeek,
  });
}
