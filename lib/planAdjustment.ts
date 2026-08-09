import { pool } from "./db";
import {
  endurance,
  recovery,
  tempo,
  groupRide,
  sweetSpot,
  threshold,
  vo2max,
  sprints,
  KeyWorkoutType,
  WorkoutTemplate,
} from "./planTemplates/ftpBuilder";
import { isKeyWorkout, getRecoveryBand, RecoveryBand } from "./recommendation";

export type SwapType = KeyWorkoutType | "endurance" | "recovery" | "group_ride";

// Types allowed when adding a brand-new workout to a rest day — intentionally
// a smaller set than full swap types, since a rest day getting a ride is
// meant to stay easy/moderate, not become a key session.
export const ADDABLE_TYPES = ["recovery", "endurance", "group_ride"] as const;
export type AddableType = (typeof ADDABLE_TYPES)[number];

// Sensible defaults if the caller doesn't specify reps/duration for an
// interval-type swap — roughly matches an early-plan version of each type.
const SWAP_DEFAULTS: Record<string, { reps?: number; onMin?: number; minutes?: number }> = {
  sweetspot: { reps: 3, onMin: 10 },
  threshold: { reps: 2, onMin: 14 },
  vo2max: { reps: 4, onMin: 4 },
  sprints: { reps: 5 },
  tempo: { minutes: 30 },
  endurance: { minutes: 75 },
  group_ride: { minutes: 90 },
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
    case "group_ride":
      return groupRide(dayOffset, minutes);
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

// Adds a brand-new workout to a date that doesn't have one yet — for filling
// in a rest day with a recovery spin, endurance ride, or group ride. Refuses
// if that date already has a workout (use swap instead for existing days).
export async function addWorkout(
  planId: number,
  date: string,
  type: AddableType,
  params: { minutes?: number }
) {
  const { rows: planRows } = await pool.query("select start_date from plans where id = $1", [planId]);
  if (planRows.length === 0) throw new Error("Plan not found");
  const planStartDate = planRows[0].start_date.toISOString().slice(0, 10);

  const { rows: existingRows } = await pool.query(
    "select id from planned_workouts where plan_id = $1 and scheduled_date = $2",
    [planId, date]
  );
  if (existingRows.length > 0) {
    throw new Error("That day already has a workout — use swap instead of add");
  }

  const pos = weekdayOffset(planStartDate, date);
  const generated = generateSwap(type, params, pos.dayOffset);

  // Inherit this week's actual phase from an existing workout in the same
  // week, so the addition blends in with the rest of the plan's labeling
  // rather than showing a placeholder phase.
  const { rows: phaseRows } = await pool.query(
    "select phase from planned_workouts where plan_id = $1 and week_number = $2 limit 1",
    [planId, pos.weekNumber]
  );
  const phase = phaseRows[0]?.phase ?? "base";

  const { rows } = await pool.query(
    `insert into planned_workouts
       (plan_id, week_number, phase, day_offset, scheduled_date, title, description, target_duration_min, target_tss, structure)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      planId,
      pos.weekNumber,
      phase,
      pos.dayOffset,
      date,
      generated.title,
      generated.description,
      generated.targetDurationMin,
      generated.targetTss,
      JSON.stringify(generated.structure),
    ]
  );

  return { id: rows[0].id, ...generated };
}

// ---------- Preview: assess impact before applying ----------

export interface WeekTssImpact {
  weekNumber: number;
  tssBefore: number;
  tssAfter: number;
  delta: number;
}

export interface RecoveryAdvice {
  available: boolean;
  band?: RecoveryBand;
  recoveryScore?: number;
  message: string;
  recommended: boolean | null; // null when no data to judge from
}

export interface ProximityAdvice {
  message: string;
  recommended: boolean;
}

export interface AdjustmentPreview {
  weeks: WeekTssImpact[];
  recovery: RecoveryAdvice;
  proximity: ProximityAdvice;
  overall: "recommended" | "caution" | "not_recommended";
}

async function weekTssTotal(planId: number, weekNumber: number): Promise<number> {
  const { rows } = await pool.query(
    "select coalesce(sum(target_tss), 0) as total from planned_workouts where plan_id = $1 and week_number = $2",
    [planId, weekNumber]
  );
  return Number(rows[0].total);
}

function adviseOnRecovery(
  recoveryRow: { recovery_score: number } | null,
  workoutIsKey: boolean
): RecoveryAdvice {
  if (!recoveryRow) {
    return {
      available: false,
      message: "No WHOOP recovery data available for that date to judge against.",
      recommended: null,
    };
  }
  const score = Number(recoveryRow.recovery_score);
  const band = getRecoveryBand(score);

  if (band === "green") {
    return { available: true, band, recoveryScore: score, message: `Recovery is green (${score}%) — no concern either way.`, recommended: true };
  }
  if (band === "yellow") {
    return workoutIsKey
      ? { available: true, band, recoveryScore: score, message: `Recovery is yellow (${score}%) — a key/hard session here is a bit ambitious.`, recommended: false }
      : { available: true, band, recoveryScore: score, message: `Recovery is yellow (${score}%) — an easier session here fits well.`, recommended: true };
  }
  // red
  return workoutIsKey
    ? { available: true, band, recoveryScore: score, message: `Recovery is red (${score}%) — a key/hard session here isn't recommended.`, recommended: false }
    : { available: true, band, recoveryScore: score, message: `Recovery is red (${score}%) — an easy session here is appropriate.`, recommended: true };
}

async function adviseOnProximity(
  planId: number,
  targetDate: string,
  workoutIsKey: boolean,
  excludeWorkoutId: number
): Promise<ProximityAdvice> {
  if (!workoutIsKey) {
    return { message: "Not a key/hard session, so day-to-day spacing isn't a concern.", recommended: true };
  }

  const target = new Date(targetDate + "T00:00:00");
  const prev = new Date(target);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(target);
  next.setDate(next.getDate() + 1);
  const prevStr = prev.toISOString().slice(0, 10);
  const nextStr = next.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    "select title, structure, scheduled_date from planned_workouts where plan_id = $1 and scheduled_date in ($2, $3) and id != $4",
    [planId, prevStr, nextStr, excludeWorkoutId]
  );

  const adjacentKey = rows.find((r: any) => isKeyWorkout(r.structure));
  if (adjacentKey) {
    const adjDate = adjacentKey.scheduled_date.toISOString().slice(0, 10);
    return {
      message: `This lands right next to another key session ("${adjacentKey.title}" on ${adjDate}) with no rest day between — back-to-back hard efforts.`,
      recommended: false,
    };
  }

  return { message: "Adjacent days are easy or rest days — good spacing for a key session.", recommended: true };
}

function combineOverall(recovery: RecoveryAdvice, proximity: ProximityAdvice): AdjustmentPreview["overall"] {
  const concerns = [recovery.recommended === false, proximity.recommended === false].filter(Boolean).length;
  if (concerns === 0) return "recommended";
  if (concerns === 1) return "caution";
  return "not_recommended";
}

export async function previewSwap(
  workoutId: number,
  type: SwapType,
  params: { reps?: number; onMin?: number; minutes?: number }
): Promise<AdjustmentPreview> {
  const { rows } = await pool.query("select * from planned_workouts where id = $1", [workoutId]);
  if (rows.length === 0) throw new Error("Workout not found");
  const workout = rows[0];

  const generated = generateSwap(type, params, workout.day_offset);
  const scheduledDate = workout.scheduled_date.toISOString().slice(0, 10);

  const tssBefore = await weekTssTotal(workout.plan_id, workout.week_number);
  const tssAfter = tssBefore - workout.target_tss + generated.targetTss;

  const [{ rows: recoveryRows }] = await Promise.all([
    pool.query("select recovery_score from recovery_days where date = $1", [scheduledDate]),
  ]);

  const newIsKey = isKeyWorkout(generated.structure);
  const recoveryAdvice = adviseOnRecovery(recoveryRows[0] ?? null, newIsKey);
  const proximityAdvice = await adviseOnProximity(workout.plan_id, scheduledDate, newIsKey, workoutId);

  return {
    weeks: [{ weekNumber: workout.week_number, tssBefore, tssAfter, delta: tssAfter - tssBefore }],
    recovery: recoveryAdvice,
    proximity: proximityAdvice,
    overall: combineOverall(recoveryAdvice, proximityAdvice),
  };
}

export async function previewMove(workoutId: number, newDate: string): Promise<AdjustmentPreview> {
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
  const oldWeekNumber = workout.week_number;

  const weeks: WeekTssImpact[] = [];
  if (oldWeekNumber === newPos.weekNumber) {
    // Same week — just reordering days, weekly total is unchanged.
    const total = await weekTssTotal(workout.plan_id, oldWeekNumber);
    weeks.push({ weekNumber: oldWeekNumber, tssBefore: total, tssAfter: total, delta: 0 });
  } else {
    const oldBefore = await weekTssTotal(workout.plan_id, oldWeekNumber);
    const newBefore = await weekTssTotal(workout.plan_id, newPos.weekNumber);
    const swapTss = existing ? existing.target_tss : 0;
    const oldAfter = oldBefore - workout.target_tss + swapTss;
    const newAfter = newBefore - swapTss + workout.target_tss;
    weeks.push({ weekNumber: oldWeekNumber, tssBefore: oldBefore, tssAfter: oldAfter, delta: oldAfter - oldBefore });
    weeks.push({ weekNumber: newPos.weekNumber, tssBefore: newBefore, tssAfter: newAfter, delta: newAfter - newBefore });
  }

  const workoutIsKey = isKeyWorkout(workout.structure);
  const { rows: recoveryRows } = await pool.query("select recovery_score from recovery_days where date = $1", [newDate]);
  const recoveryAdvice = adviseOnRecovery(recoveryRows[0] ?? null, workoutIsKey);
  const proximityAdvice = await adviseOnProximity(workout.plan_id, newDate, workoutIsKey, workoutId);

  return {
    weeks,
    recovery: recoveryAdvice,
    proximity: proximityAdvice,
    overall: combineOverall(recoveryAdvice, proximityAdvice),
  };
}

export async function previewAdd(
  planId: number,
  date: string,
  type: AddableType,
  params: { minutes?: number }
): Promise<AdjustmentPreview> {
  const { rows: planRows } = await pool.query("select start_date from plans where id = $1", [planId]);
  if (planRows.length === 0) throw new Error("Plan not found");
  const planStartDate = planRows[0].start_date.toISOString().slice(0, 10);

  const pos = weekdayOffset(planStartDate, date);
  const generated = generateSwap(type, params, pos.dayOffset);

  const tssBefore = await weekTssTotal(planId, pos.weekNumber);
  const tssAfter = tssBefore + generated.targetTss; // adding, not replacing

  const isKey = isKeyWorkout(generated.structure); // always false for addable types, kept for consistency
  const { rows: recoveryRows } = await pool.query("select recovery_score from recovery_days where date = $1", [date]);
  const recoveryAdvice = adviseOnRecovery(recoveryRows[0] ?? null, isKey);
  // No existing workout id to exclude yet — 0 never matches a real row.
  const proximityAdvice = await adviseOnProximity(planId, date, isKey, 0);

  return {
    weeks: [{ weekNumber: pos.weekNumber, tssBefore, tssAfter, delta: tssAfter - tssBefore }],
    recovery: recoveryAdvice,
    proximity: proximityAdvice,
    overall: combineOverall(recoveryAdvice, proximityAdvice),
  };
}
