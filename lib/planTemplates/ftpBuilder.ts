import { computeTargetTss } from "../tss";

// FTP-building plan generator, parameterized by:
//   - durationWeeks: total plan length the user wants
//   - keyWorkoutsPerWeek: how many quality interval sessions per week (1-4)
//   - targetWeeklyHours: total weekly training time to hit
//   - ridesPerWeek: total rides/week including key workouts — remaining
//     days are filled with zone 2 endurance/recovery rides sized to
//     actually reach the weekly hour target
//   - allowedTypes: which interval session types the plan is allowed to draw
//     from (e.g. exclude threshold entirely and only use sweet spot + VO2max)
//
// Progression model: base/build/peak/taper labels still group weeks broadly
// (they drive which workout TYPES are preferred and are shown in the UI),
// but interval progression itself (reps/duration) is driven by a single
// global fraction across the whole plan, so ramping continues smoothly
// across phase boundaries instead of resetting each time. Every 4th week
// (once the plan is long enough to benefit) is a recovery/step-back week —
// standard 3:1 build:recover periodization — with both reduced key-workout
// volume and a reduced weekly-hour budget, not just lighter intensity.

export interface WorkoutTemplate {
  dayOffset: number; // 0=Mon ... 6=Sun, days since that week's Monday
  title: string;
  description: string;
  targetDurationMin: number;
  targetTss: number;
  structure: any;
}

export interface WeekTemplate {
  weekNumber: number;
  phase: "base" | "build" | "peak" | "taper";
  workouts: WorkoutTemplate[];
}

type Phase = "base" | "build" | "peak" | "taper";
export type KeyWorkoutType = "sweetspot" | "threshold" | "vo2max" | "sprints" | "tempo";

export const ALL_WORKOUT_TYPES: KeyWorkoutType[] = ["sweetspot", "tempo", "threshold", "vo2max", "sprints"];

// Preferred day-offset order to assign key workout slots, then filler slots,
// so key sessions land on non-consecutive days where possible.
const DAY_PRIORITY = [1, 3, 5, 6, 2, 4, 0]; // Tue, Thu, Sat, Sun, Wed, Fri, Mon

// Which workout types a phase prefers, in rotation-weight order (repeats =
// more weight). Filtered down to whatever the user actually allows.
const PHASE_TYPE_PREFERENCE: Record<Phase, KeyWorkoutType[]> = {
  base: ["sweetspot", "sweetspot", "tempo", "vo2max"],
  build: ["threshold", "threshold", "vo2max", "sweetspot"],
  peak: ["vo2max", "sprints", "vo2max", "threshold"],
  taper: ["threshold"],
};

// Ascending physiological demand — used to pick a "light" type for recovery
// weeks and taper, filtered to what's allowed.
const LIGHT_TO_HEAVY: KeyWorkoutType[] = ["sweetspot", "tempo", "threshold", "vo2max", "sprints"];

// Progression stages per type: each successive real occurrence of that type
// in the plan steps to the next entry (clamped at the last once exhausted).
// This is what keeps the ramp gradual regardless of how often a type is
// scheduled — a type used every 4th key session still only advances one
// small step each time it actually recurs, instead of jumping based on how
// far along the calendar happens to be.
const SWEETSPOT_STAGES: Array<[number, number]> = [
  [3, 8], [3, 9], [3, 10], [4, 10], [4, 11], [4, 12], [4, 13],
]; // [reps, onMin]
const THRESHOLD_STAGES: Array<[number, number]> = [
  [2, 12], [2, 14], [2, 16], [3, 16], [3, 17], [3, 18], [3, 20],
];
const VO2MAX_STAGES: Array<[number, number]> = [
  [4, 3], [4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [6, 7],
];
const SPRINTS_STAGES: number[] = [4, 5, 6, 6, 7, 8, 8]; // reps, onSec fixed at 30
const TEMPO_STAGES: number[] = [20, 25, 30, 35, 40, 45, 50]; // minutes

function stageAt<T>(stages: T[], occurrenceIdx: number): T {
  return stages[Math.min(occurrenceIdx, stages.length - 1)];
}

function round(n: number): number {
  return Math.round(n);
}

function poolForPhase(phase: Phase, allowedTypes: KeyWorkoutType[]): KeyWorkoutType[] {
  const preferred = PHASE_TYPE_PREFERENCE[phase].filter((t) => allowedTypes.includes(t));
  if (preferred.length > 0) return preferred;
  // None of this phase's preferred types are allowed — fall back to
  // whatever the user did allow, rather than producing nothing.
  return allowedTypes.length > 0 ? allowedTypes : ["sweetspot"];
}

function lightType(allowedTypes: KeyWorkoutType[]): KeyWorkoutType {
  return LIGHT_TO_HEAVY.find((t) => allowedTypes.includes(t)) ?? allowedTypes[0] ?? "sweetspot";
}

// ---------- Workout generators ----------

export function endurance(dayOffset: number, minutes: number): WorkoutTemplate {
  const structure = [{ type: "steady", min: minutes, pct_ftp: [55, 75] }];
  return {
    dayOffset,
    title: "Endurance ride",
    description: `${minutes} min steady zone 2 (55-75% FTP), conversational pace.`,
    targetDurationMin: minutes,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function recovery(dayOffset: number): WorkoutTemplate {
  const structure = [{ type: "steady", min: 35, pct_ftp: [40, 55] }];
  return {
    dayOffset,
    title: "Recovery spin",
    description: "30-40min easy spin, well below zone 2, legs-only effort.",
    targetDurationMin: 35,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function tempo(dayOffset: number, minutes: number): WorkoutTemplate {
  const structure = [{ type: "steady", min: minutes, pct_ftp: [76, 90] }];
  return {
    dayOffset,
    title: "Tempo",
    description: `${minutes} min @ 76-90% FTP tempo pace — harder than endurance, short of threshold.`,
    targetDurationMin: minutes,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function groupRide(dayOffset: number, minutes: number): WorkoutTemplate {
  const structure = [{ type: "steady", min: minutes, pct_ftp: [60, 85] }];
  return {
    dayOffset,
    title: "Group ride",
    description: `${minutes} min group ride — variable pace and effort depending on the group, expect surges.`,
    targetDurationMin: minutes,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function sweetSpot(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 15 + reps * (onMin + 5) + 10;
  const structure = [
    { type: "warmup", min: 15 },
    { type: "interval", reps, on_min: onMin, on_pct_ftp: [88, 94], off_min: 5, off_pct_ftp: 50 },
    { type: "cooldown", min: 10 },
  ];
  return {
    dayOffset,
    title: `Sweet spot ${reps}x${onMin}min`,
    description: `Warm up 15min, ${reps} x ${onMin}min @ 88-94% FTP with 5min easy spin recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function threshold(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 15 + reps * (onMin + 5) + 10;
  const structure = [
    { type: "warmup", min: 15 },
    { type: "interval", reps, on_min: onMin, on_pct_ftp: [95, 105], off_min: 5, off_pct_ftp: 50 },
    { type: "cooldown", min: 10 },
  ];
  return {
    dayOffset,
    title: `Threshold ${reps}x${onMin}min`,
    description: `Warm up 15min, ${reps} x ${onMin}min @ 95-105% FTP with 5min easy spin recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function vo2max(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 20 + reps * (onMin + onMin) + 10;
  const structure = [
    { type: "warmup", min: 20 },
    { type: "interval", reps, on_min: onMin, on_pct_ftp: [106, 120], off_min: onMin, off_pct_ftp: 50 },
    { type: "cooldown", min: 10 },
  ];
  return {
    dayOffset,
    title: `VO2max ${reps}x${onMin}min`,
    description: `Warm up 20min with openers, ${reps} x ${onMin}min @ 106-120% FTP with equal-time easy spin recovery, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

export function sprints(dayOffset: number, reps: number, onSec: number): WorkoutTemplate {
  const onMin = onSec / 60;
  const offMin = 4.5;
  const totalMin = round(20 + reps * (onMin + offMin) + 10);
  const structure = [
    { type: "warmup", min: 20 },
    { type: "interval", reps, on_min: onMin, on_pct_ftp: [150, 180], off_min: offMin, off_pct_ftp: 40 },
    { type: "cooldown", min: 10 },
  ];
  return {
    dayOffset,
    title: `Sprints ${reps}x${onSec}s`,
    description: `Warm up 20min with openers, ${reps} x ${onSec}s all-out (150-180% FTP) with ${offMin}min full recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

function ftpTest(dayOffset: number): WorkoutTemplate {
  const structure = [
    { type: "warmup", min: 20 },
    { type: "test", protocol: "20min_ftp_test", min: 20 },
    { type: "cooldown", min: 15 },
  ];
  return {
    dayOffset,
    title: "FTP test",
    description:
      "Warm up 20min including 2x5min buildups. Then a 20min all-out sustained effort. Take 95% of average power as new FTP. Cool down 15min.",
    targetDurationMin: 60,
    targetTss: computeTargetTss(structure),
    structure,
  };
}

// Generates a specific type at a given occurrence index (how many times this
// type has already appeared earlier in the plan — NOT calendar position) and
// intensity scale (used to lighten 2nd+ key sessions and recovery weeks).
function generateByType(
  type: KeyWorkoutType,
  dayOffset: number,
  occurrenceIdx: number,
  intensityScale: number
): WorkoutTemplate {
  switch (type) {
    case "sweetspot": {
      const [baseReps, onMin] = stageAt(SWEETSPOT_STAGES, occurrenceIdx);
      const reps = Math.max(round(baseReps * intensityScale), 2);
      return sweetSpot(dayOffset, reps, onMin);
    }
    case "threshold": {
      const [baseReps, onMin] = stageAt(THRESHOLD_STAGES, occurrenceIdx);
      const reps = Math.max(round(baseReps * intensityScale), 2);
      return threshold(dayOffset, reps, onMin);
    }
    case "vo2max": {
      const [baseReps, onMin] = stageAt(VO2MAX_STAGES, occurrenceIdx);
      const reps = Math.max(round(baseReps * intensityScale), 3);
      return vo2max(dayOffset, reps, onMin);
    }
    case "sprints": {
      const baseReps = stageAt(SPRINTS_STAGES, occurrenceIdx);
      const reps = Math.max(round(baseReps * intensityScale), 4);
      return sprints(dayOffset, reps, 30);
    }
    case "tempo": {
      const baseMinutes = stageAt(TEMPO_STAGES, occurrenceIdx);
      const minutes = Math.max(round(baseMinutes * intensityScale), 20);
      return tempo(dayOffset, minutes);
    }
  }
}

// Light, fixed-low-volume version used for taper — conservative regardless
// of which type ends up selected.
function generateTaperByType(type: KeyWorkoutType, dayOffset: number): WorkoutTemplate {
  switch (type) {
    case "sweetspot":
      return sweetSpot(dayOffset, 2, 8);
    case "tempo":
      return tempo(dayOffset, 20);
    case "threshold":
      return threshold(dayOffset, 2, 8);
    case "vo2max":
      return vo2max(dayOffset, 3, 3);
    case "sprints":
      return sprints(dayOffset, 4, 20);
  }
}

// ---------- Phase/week structure ----------

// Splits durationWeeks into base/build/peak/taper week counts.
// Taper (incl. FTP retest) is always the final week. Peak and build scale
// with plan length; base absorbs whatever's left. Designed for 6+ week plans;
// short plans (4-5 weeks) collapse peak into build.
function allocatePhases(durationWeeks: number) {
  const taper = 1;
  let remaining = durationWeeks - taper;

  const peak = remaining >= 6 ? Math.max(1, round(remaining * 0.2)) : remaining >= 3 ? 1 : 0;
  remaining -= peak;

  let build = remaining >= 2 ? Math.max(1, round(remaining * 0.45)) : remaining;
  remaining -= build;

  let base = Math.max(remaining, 1);
  const total = base + build + peak + taper;
  if (total > durationWeeks) base -= total - durationWeeks;
  base = Math.max(base, 0);

  return { base, build, peak, taper };
}

// Assigns day offsets: key workout days first (spread across the week),
// then filler zone-2 days to reach the user's chosen ridesPerWeek total.
function assignDays(keyWorkoutsPerWeek: number, ridesPerWeek: number) {
  const keyCount = Math.min(keyWorkoutsPerWeek, ridesPerWeek);
  const keyDays = DAY_PRIORITY.slice(0, keyCount).sort((a, b) => a - b);
  const fillerCount = Math.max(0, ridesPerWeek - keyCount);
  const fillerDays = DAY_PRIORITY.slice(keyCount, keyCount + fillerCount).sort((a, b) => a - b);
  return { keyDays, fillerDays };
}

// Every 4th week is a recovery/step-back week — standard 3:1 build:recover
// periodization. Skipped for short plans (recovery weeks only kick in once
// there's enough length to benefit), and never applied to the final
// taper/test week, which already handles its own volume drop.
function isRecoveryWeek(weekNumber: number, durationWeeks: number): boolean {
  if (durationWeeks < 8) return false;
  if (weekNumber >= durationWeeks) return false;
  return weekNumber % 4 === 0;
}

// Builds one key workout. Type comes from the phase's (allowed-filtered)
// rotation pool. Progression magnitude (reps/duration) is driven by that
// TYPE's own occurrence count so far in the plan (see occurrenceCounts),
// not calendar position — this is what keeps a type's ramp gradual even
// when it only shows up occasionally. On a recovery week, type drops to the
// lightest allowed option, uses its current (not advanced) occurrence stage,
// and volume is pulled back further — real progressive-overload plans step
// back periodically rather than ramping every single week without a break.
function buildKeyWorkout(
  phase: Phase,
  weekNumber: number,
  isRecovery: boolean,
  keyIndex: number,
  keyWorkoutsPerWeek: number,
  dayOffset: number,
  allowedTypes: KeyWorkoutType[],
  occurrenceCounts: Record<KeyWorkoutType, number>
): WorkoutTemplate {
  if (phase === "taper") {
    return generateTaperByType(lightType(allowedTypes), dayOffset);
  }

  let type: KeyWorkoutType;
  if (isRecovery) {
    type = lightType(allowedTypes);
  } else {
    const pool = poolForPhase(phase, allowedTypes);
    const typeIdx = (weekNumber * keyWorkoutsPerWeek + keyIndex) % pool.length;
    type = pool[typeIdx];
  }

  let intensityScale = keyIndex === 0 ? 1 : 0.85;
  if (isRecovery) intensityScale *= 0.65;

  // Recovery-week appearances read the type's current stage but don't
  // advance it — they're a step back, not part of the forward progression.
  const occurrenceIdx = occurrenceCounts[type];
  const workout = generateByType(type, dayOffset, occurrenceIdx, intensityScale);
  if (!isRecovery) occurrenceCounts[type] = occurrenceIdx + 1;

  return workout;
}

// Given filler (zone 2) days for a week and the total minutes already
// committed to key workouts, sizes each filler ride to actually hit the
// target weekly volume — every filler day's duration is derived from the
// remaining budget, never hardcoded, so the plan's weekly total genuinely
// matches what was asked for. Weight increases linearly toward the last
// (long) day; the first filler day is only labeled "recovery" if its
// computed share naturally comes out short — otherwise it's real volume
// and gets described (and dosed) as an endurance ride.
function buildFillerWorkouts(
  fillerDays: number[],
  targetWeeklyMinutes: number,
  keyMinutesTotal: number,
  phase: Phase
): WorkoutTemplate[] {
  if (fillerDays.length === 0) return [];

  const remaining = Math.max(targetWeeklyMinutes - keyMinutesTotal, fillerDays.length * 30);

  const weights = fillerDays.map((_, i) => i + 1); // linearly increasing weight toward the long day
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return fillerDays.map((d, i) => {
    const minutes = Math.max(round((remaining * weights[i]) / totalWeight), 30);
    const isFirstOfSeveral = fillerDays.length >= 3 && i === 0 && phase !== "taper";
    if (isFirstOfSeveral && minutes <= 50) {
      return recovery(d);
    }
    return endurance(d, minutes);
  });
}

export function buildFtpBuilderTemplate(
  durationWeeks: number,
  keyWorkoutsPerWeek: number,
  targetWeeklyHours: number,
  ridesPerWeek: number,
  allowedTypes: KeyWorkoutType[]
): WeekTemplate[] {
  const safeAllowedTypes = allowedTypes.length > 0 ? allowedTypes : ALL_WORKOUT_TYPES;
  const { base, build, peak, taper } = allocatePhases(durationWeeks);
  const { keyDays, fillerDays } = assignDays(keyWorkoutsPerWeek, ridesPerWeek);
  const weeks: WeekTemplate[] = [];
  let weekNumber = 1;
  const occurrenceCounts: Record<KeyWorkoutType, number> = {
    sweetspot: 0,
    tempo: 0,
    threshold: 0,
    vo2max: 0,
    sprints: 0,
  };

  const phaseSequence: Array<{ phase: Phase; count: number }> = [
    { phase: "base", count: base },
    { phase: "build", count: build },
    { phase: "peak", count: peak },
    { phase: "taper", count: taper },
  ];

  for (const { phase, count } of phaseSequence) {
    for (let weekIdx = 0; weekIdx < count; weekIdx++) {
      const isLastWeekOfPlan = weekNumber === durationWeeks;
      const workouts: WorkoutTemplate[] = [];

      if (isLastWeekOfPlan) {
        // Retest week: easy days + one FTP test, regardless of key-workout count
        const testDay = keyDays[0] ?? fillerDays[0] ?? 3;
        workouts.push(ftpTest(testDay));
        for (const d of [...keyDays, ...fillerDays].filter((d) => d !== testDay)) {
          workouts.push(recovery(d));
        }
      } else {
        const recoveryWeek = isRecoveryWeek(weekNumber, durationWeeks);

        const keyWorkouts = keyDays.map((d, i) =>
          buildKeyWorkout(
            phase,
            weekNumber,
            recoveryWeek,
            i,
            keyWorkoutsPerWeek,
            d,
            safeAllowedTypes,
            occurrenceCounts
          )
        );
        const keyMinutesTotal = keyWorkouts.reduce((sum, w) => sum + w.targetDurationMin, 0);
        // Recovery weeks also pull back total weekly volume, not just intensity.
        const weeklyMinuteBudget = targetWeeklyHours * 60 * (recoveryWeek ? 0.75 : 1);
        const fillerWorkouts = buildFillerWorkouts(fillerDays, weeklyMinuteBudget, keyMinutesTotal, phase);
        workouts.push(...keyWorkouts, ...fillerWorkouts);
      }

      weeks.push({ weekNumber, phase, workouts });
      weekNumber++;
    }
  }

  return weeks;
}
