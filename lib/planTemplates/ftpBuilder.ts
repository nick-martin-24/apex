// FTP-building plan generator, parameterized by:
//   - durationWeeks: total plan length the user wants
//   - keyWorkoutsPerWeek: how many quality interval sessions per week (1-4)
//   - targetWeeklyHours: total weekly training time to hit
// Remaining ride days each week are filled with zone 2 endurance rides sized
// to actually reach the weekly hour target (see buildFillerWorkouts).
// Phases (base/build/peak/taper) are allocated proportionally to durationWeeks,
// and each phase draws its key workouts from a rotating pool of workout types
// so the plan isn't just one repeated interval shape for its entire length.

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
type KeyWorkoutType = "sweetspot" | "threshold" | "vo2max" | "sprints" | "tempo";

// Total rides/week is fixed at 4 for now (key workouts + zone 2 fillers).
// Worth revisiting as a third input once other plan types exist.
const TOTAL_RIDES_PER_WEEK = 4;

// Preferred day-offset order to assign key workout slots, then filler slots,
// so key sessions land on non-consecutive days where possible.
const DAY_PRIORITY = [1, 3, 5, 6, 2, 4, 0]; // Tue, Thu, Sat, Sun, Wed, Fri, Mon

// Which workout types a phase draws from, and in what rotation. This is what
// gives the plan variety instead of repeating one interval shape for weeks.
const PHASE_POOLS: Record<Phase, KeyWorkoutType[]> = {
  base: ["sweetspot", "sweetspot", "sweetspot", "vo2max"], // occasional VO2max touch to keep top-end alive
  build: ["threshold", "threshold", "vo2max", "sweetspot"],
  peak: ["vo2max", "sprints", "vo2max", "threshold"],
  taper: ["threshold"], // kept simple/conservative — no variety needed here
};

function round(n: number): number {
  return Math.round(n);
}

function lerp(start: number, end: number, frac: number): number {
  return round(start + (end - start) * frac);
}

// ---------- Workout generators ----------

function endurance(dayOffset: number, minutes: number): WorkoutTemplate {
  return {
    dayOffset,
    title: "Endurance ride",
    description: `${minutes} min steady zone 2 (55-75% FTP), conversational pace.`,
    targetDurationMin: minutes,
    targetTss: round(minutes * 0.6),
    structure: [{ type: "steady", min: minutes, pct_ftp: [55, 75] }],
  };
}

function recovery(dayOffset: number): WorkoutTemplate {
  return {
    dayOffset,
    title: "Recovery spin",
    description: "30-40min easy spin, well below zone 2, legs-only effort.",
    targetDurationMin: 35,
    targetTss: 20,
    structure: [{ type: "steady", min: 35, pct_ftp: [40, 55] }],
  };
}

function tempo(dayOffset: number, minutes: number): WorkoutTemplate {
  return {
    dayOffset,
    title: "Tempo",
    description: `${minutes} min @ 76-90% FTP tempo pace — harder than endurance, short of threshold.`,
    targetDurationMin: minutes,
    targetTss: round(minutes * 0.75),
    structure: [{ type: "steady", min: minutes, pct_ftp: [76, 90] }],
  };
}

function sweetSpot(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 15 + reps * (onMin + 5) + 10;
  return {
    dayOffset,
    title: `Sweet spot ${reps}x${onMin}min`,
    description: `Warm up 15min, ${reps} x ${onMin}min @ 88-94% FTP with 5min easy spin recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: round(reps * onMin * 1.0 + totalMin * 0.15),
    structure: [
      { type: "warmup", min: 15 },
      { type: "interval", reps, on_min: onMin, on_pct_ftp: [88, 94], off_min: 5, off_pct_ftp: 50 },
      { type: "cooldown", min: 10 },
    ],
  };
}

function threshold(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 15 + reps * (onMin + 5) + 10;
  return {
    dayOffset,
    title: `Threshold ${reps}x${onMin}min`,
    description: `Warm up 15min, ${reps} x ${onMin}min @ 95-105% FTP with 5min easy spin recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: round(reps * onMin * 1.05 + totalMin * 0.15),
    structure: [
      { type: "warmup", min: 15 },
      { type: "interval", reps, on_min: onMin, on_pct_ftp: [95, 105], off_min: 5, off_pct_ftp: 50 },
      { type: "cooldown", min: 10 },
    ],
  };
}

function vo2max(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 20 + reps * (onMin + onMin) + 10;
  return {
    dayOffset,
    title: `VO2max ${reps}x${onMin}min`,
    description: `Warm up 20min with openers, ${reps} x ${onMin}min @ 106-120% FTP with equal-time easy spin recovery, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: round(reps * onMin * 1.15 + totalMin * 0.15),
    structure: [
      { type: "warmup", min: 20 },
      { type: "interval", reps, on_min: onMin, on_pct_ftp: [106, 120], off_min: onMin, off_pct_ftp: 50 },
      { type: "cooldown", min: 10 },
    ],
  };
}

function sprints(dayOffset: number, reps: number, onSec: number): WorkoutTemplate {
  const onMin = onSec / 60;
  const offMin = 4.5;
  const totalMin = round(20 + reps * (onMin + offMin) + 10);
  return {
    dayOffset,
    title: `Sprints ${reps}x${onSec}s`,
    description: `Warm up 20min with openers, ${reps} x ${onSec}s all-out (150-180% FTP) with ${offMin}min full recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: round(reps * onMin * 1.6 + totalMin * 0.15),
    structure: [
      { type: "warmup", min: 20 },
      { type: "interval", reps, on_min: onMin, on_pct_ftp: [150, 180], off_min: offMin, off_pct_ftp: 40 },
      { type: "cooldown", min: 10 },
    ],
  };
}

function ftpTest(dayOffset: number): WorkoutTemplate {
  return {
    dayOffset,
    title: "FTP test",
    description:
      "Warm up 20min including 2x5min buildups. Then a 20min all-out sustained effort. Take 95% of average power as new FTP. Cool down 15min.",
    targetDurationMin: 60,
    targetTss: 75,
    structure: [
      { type: "warmup", min: 20 },
      { type: "test", protocol: "20min_ftp_test", min: 20 },
      { type: "cooldown", min: 15 },
    ],
  };
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
// then filler zone-2 days to reach TOTAL_RIDES_PER_WEEK.
function assignDays(keyWorkoutsPerWeek: number) {
  const keyCount = Math.min(keyWorkoutsPerWeek, TOTAL_RIDES_PER_WEEK);
  const keyDays = DAY_PRIORITY.slice(0, keyCount).sort((a, b) => a - b);
  const fillerCount = Math.max(0, TOTAL_RIDES_PER_WEEK - keyCount);
  const fillerDays = DAY_PRIORITY.slice(keyCount, keyCount + fillerCount).sort((a, b) => a - b);
  return { keyDays, fillerDays };
}

// Builds one key workout: picks a type from the phase's rotation pool (varying
// by both week and which key session of the week this is, so a plan doesn't
// repeat the same shape every time), then generates it with duration/reps that
// progress across the phase.
function buildKeyWorkout(
  phase: Phase,
  weekIdx: number,
  totalWeeksInPhase: number,
  keyIndex: number,
  keyWorkoutsPerWeek: number,
  dayOffset: number
): WorkoutTemplate {
  if (phase === "taper") {
    return threshold(dayOffset, 2, 8);
  }

  const pool = PHASE_POOLS[phase];
  const typeIdx = (weekIdx * keyWorkoutsPerWeek + keyIndex) % pool.length;
  const type = pool[typeIdx];

  const frac = totalWeeksInPhase <= 1 ? 1 : weekIdx / (totalWeeksInPhase - 1);
  // Second/third+ key session of the week is a bit lighter than the first,
  // but not drastically scaled down now that types vary (no need to always
  // "protect" against two max-effort days when the types themselves differ).
  const intensityScale = keyIndex === 0 ? 1 : 0.85;

  switch (type) {
    case "sweetspot": {
      const reps = round(lerp(3, 4, frac) * intensityScale) || 2;
      const onMin = lerp(8, 12, frac);
      return sweetSpot(dayOffset, Math.max(reps, 2), onMin);
    }
    case "threshold": {
      const reps = round(lerp(2, 3, frac) * intensityScale) || 2;
      const onMin = lerp(12, 18, frac);
      return threshold(dayOffset, Math.max(reps, 2), onMin);
    }
    case "vo2max": {
      const reps = round(lerp(4, 6, frac) * intensityScale) || 3;
      const onMin = lerp(3, 5, frac);
      return vo2max(dayOffset, Math.max(reps, 3), onMin);
    }
    case "sprints": {
      const reps = round(lerp(5, 8, frac) * intensityScale) || 4;
      return sprints(dayOffset, Math.max(reps, 4), 30);
    }
    case "tempo": {
      const minutes = round(lerp(30, 45, frac) * intensityScale) || 20;
      return tempo(dayOffset, Math.max(minutes, 20));
    }
  }
}

// Given filler (zone 2) days for a week and the total minutes already
// committed to key workouts, sizes each filler ride to actually hit the
// target weekly volume — every filler day's duration is derived from the
// remaining budget, never hardcoded, so the plan's weekly total genuinely
// matches what was asked for. The last filler day (usually Sunday) carries
// the most weight as the "long ride"; with 3+ filler days, the first one
// stays lighter (recovery-flavored) but still scales if the target demands it.
function buildFillerWorkouts(
  fillerDays: number[],
  targetWeeklyMinutes: number,
  keyMinutesTotal: number,
  phase: Phase
): WorkoutTemplate[] {
  if (fillerDays.length === 0) return [];

  const remaining = Math.max(targetWeeklyMinutes - keyMinutesTotal, fillerDays.length * 30);

  let weights: number[];
  if (fillerDays.length === 1) weights = [1];
  else if (fillerDays.length === 2) weights = [0.42, 0.58];
  else if (fillerDays.length === 3) weights = [0.18, 0.34, 0.48];
  else weights = fillerDays.map(() => 1 / fillerDays.length);

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return fillerDays.map((d, i) => {
    const minutes = Math.max(round((remaining * weights[i]) / totalWeight), 30);
    const isFirstOfThreeOrMore = fillerDays.length >= 3 && i === 0 && phase !== "taper";
    // Only label it a genuine "recovery" day if the actual computed time is
    // short enough to still be one — otherwise it's carrying real volume for
    // the target and should be described (and dosed) as an endurance ride.
    if (isFirstOfThreeOrMore && minutes <= 50) {
      return recovery(d);
    }
    return endurance(d, minutes);
  });
}

export function buildFtpBuilderTemplate(
  durationWeeks: number,
  keyWorkoutsPerWeek: number,
  targetWeeklyHours: number
): WeekTemplate[] {
  const { base, build, peak, taper } = allocatePhases(durationWeeks);
  const { keyDays, fillerDays } = assignDays(keyWorkoutsPerWeek);
  const weeks: WeekTemplate[] = [];
  let weekNumber = 1;

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
        const keyWorkouts = keyDays.map((d, i) =>
          buildKeyWorkout(phase, weekIdx, count, i, keyWorkoutsPerWeek, d)
        );
        const keyMinutesTotal = keyWorkouts.reduce((sum, w) => sum + w.targetDurationMin, 0);
        const fillerWorkouts = buildFillerWorkouts(fillerDays, targetWeeklyHours * 60, keyMinutesTotal, phase);
        workouts.push(...keyWorkouts, ...fillerWorkouts);
      }

      weeks.push({ weekNumber, phase, workouts });
      weekNumber++;
    }
  }

  return weeks;
}
