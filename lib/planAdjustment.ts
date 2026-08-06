import { pool } from "./db";
import {
  endurance,
  recovery,
  tempo,
  sweetSpot,
  threshold,
  vo2max,
  sprints,
  KeyWorkoutType,
  WorkoutTemplate,
} from "./planTemplates/ftpBuilder";

export type SwapType = KeyWorkoutType | "endurance" | "recovery";

// Sensible defaults if the caller doesn't specify reps/duration for an
// interval-type swap — roughly matches an early-plan version of each type.
const SWAP_DEFAULTS: Record<string, { reps?: number; onMin?: number; minutes?: number }> = {
  sweetspot: { reps: 3, onMin: 10 },
  threshold: { reps: 2, onMin: 14 },
  vo2max: { reps: 4, onMin: 4 },
  sprints: { reps: 5 },
  tempo: { minutes: 30 },
  endurance: { minutes: 75 },
};

export function generateSwap(
  type: SwapType,
  params: { reps?: number; onMin?: number; minutes?: number },
  dayOffset: number
): WorkoutTemplate {
  const defaults = SWAP_DEFAULTS[type] ?? {};
  const reps = params.reps ?? defaults.reps ?? 3;
  const onMin = params.onMin ?? defaults.onMin ?? 10;
  const minutes = params.minutes ?? defaults.minutes ?? 60;

  switch (type) {
    case "recovery":
      return recovery(dayOffset);
    case "endurance":
      return endurance(dayOffset, minutes);
    case "tempo":
      return tempo(dayOffset, minutes);
    case "sweetspot":
      return sweetSpot(dayOffset, reps, onMin);
    case "threshold":
      return threshold(dayOffset, reps, onMin);
    case "vo2max":
      return vo2max(dayOffset, reps, onMin);
    case "sprints":
      return sprints(dayOffset, reps, 30);
  }
}

// Replaces a planned workout's content (title/description/duration/TSS/structure)
// with a freshly generated workout of the requested type — used for same-day
// swaps like "turn today's recovery spin into a slightly harder zone 2 ride."
export async function swapWorkout(
  workoutId: number,
  type: SwapType,
  params: { reps?: number; onMin?: number; minutes?: number }
) {
  const { rows } = await pool.query("select day_offset from planned_workouts where id = $1", [workoutId]);
  if (rows.length === 0) throw new Error("Workout not found");

  const generated = generateSwap(type, params, rows[0].day_offset);

  await pool.query(
    `update planned_workouts
     set title = $1, description = $2, target_duration_min = $3, target_tss = $4, structure = $5
     where id = $6`,
    [generated.title, generated.description, generated.targetDurationMin, generated.targetTss, JSON.stringify(generated.structure), workoutId]
  );

  return generated;
}

function weekdayOffset(planStartDate: string, date: string): { weekNumber: number; dayOffset: number } {
  const start = new Date(planStartDate + "T00:00:00");
  const target = new Date(date + "T00:00:00");
  const daysBetween = Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return {
    weekNumber: Math.floor(daysBetween / 7) + 1,
    dayOffset: ((daysBetween % 7) + 7) % 7,
  };
}

// Reschedules a planned workout to a new date. If another workout in the
// same plan is already scheduled on that date, the two swap dates with each
// other (rather than colliding) — matches how you'd actually want "move my
// Wednesday VO2max to Friday" to behave: Friday's original ride moves back
// to Wednesday, nothing is lost or overwritten.
export async function moveWorkout(workoutId: number, newDate: string) {
  const { rows: workoutRows } = await pool.query("select * from planned_workouts where id = $1", [workoutId]);
  if (workoutRows.length === 0) throw new Error("Workout not found");
  const workout = workoutRows[0];

  const { rows: planRows } = await pool.query("select start_date from plans where id = $1", [workout.plan_id]);
  if (planRows.length === 0) throw new Error("Plan not found");
  const planStartDate = planRows[0].start_date.toISOString().slice(0, 10);

  const { rows: existingRows } = await pool.query(
    "select * from planned_workouts where plan_id = $1 and scheduled_date = $2 and id != $3",
    [workout.plan_id, newDate, workoutId]
  );
  const existing = existingRows[0] ?? null;

  const newPos = weekdayOffset(planStartDate, newDate);

  await pool.query(
    `update planned_workouts set scheduled_date = $1, week_number = $2, day_offset = $3 where id = $4`,
    [newDate, newPos.weekNumber, newPos.dayOffset, workoutId]
  );

  if (existing) {
    const oldDate = workout.scheduled_date.toISOString().slice(0, 10);
    const oldPos = weekdayOffset(planStartDate, oldDate);
    await pool.query(
      `update planned_workouts set scheduled_date = $1, week_number = $2, day_offset = $3 where id = $4`,
      [oldDate, oldPos.weekNumber, oldPos.dayOffset, existing.id]
    );
  }

  return { moved: workoutId, newDate, swappedWith: existing ? { id: existing.id, movedTo: workout.scheduled_date.toISOString().slice(0, 10) } : null };
}
