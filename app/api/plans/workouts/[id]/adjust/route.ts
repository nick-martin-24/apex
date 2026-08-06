import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { swapWorkout, moveWorkout, SwapType } from "@/lib/planAdjustment";
import { ALL_WORKOUT_TYPES } from "@/lib/planTemplates/ftpBuilder";

export const dynamic = "force-dynamic";

const SWAPPABLE_TYPES = ["recovery", "endurance", ...ALL_WORKOUT_TYPES];

// POST { "action": "swap", "workout_type": "endurance", "reps": 3, "on_min": 10, "minutes": 75 }
// POST { "action": "move", "new_date": "2026-08-14" }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const workoutId = Number(params.id);
  const body = await req.json();

  const { rows } = await pool.query(
    "select completed_activity_id from planned_workouts where id = $1",
    [workoutId]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Planned workout not found" }, { status: 404 });
  }
  if (rows[0].completed_activity_id) {
    return NextResponse.json(
      { error: "This workout is already linked to a completed ride and can't be adjusted" },
      { status: 400 }
    );
  }

  if (body.action === "swap") {
    if (!SWAPPABLE_TYPES.includes(body.workout_type)) {
      return NextResponse.json({ error: `workout_type must be one of: ${SWAPPABLE_TYPES.join(", ")}` }, { status: 400 });
    }
    const generated = await swapWorkout(workoutId, body.workout_type as SwapType, {
      reps: body.reps ? Number(body.reps) : undefined,
      onMin: body.on_min ? Number(body.on_min) : undefined,
      minutes: body.minutes ? Number(body.minutes) : undefined,
    });
    return NextResponse.json({ ok: true, workout: generated });
  }

  if (body.action === "move") {
    if (!body.new_date) {
      return NextResponse.json({ error: "new_date (YYYY-MM-DD) is required" }, { status: 400 });
    }
    const result = await moveWorkout(workoutId, body.new_date);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "action must be 'swap' or 'move'" }, { status: 400 });
}
