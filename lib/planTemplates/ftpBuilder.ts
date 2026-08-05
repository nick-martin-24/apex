// FTP-building plan generator, parameterized by:
//   - durationWeeks: total plan length the user wants
//   - keyWorkoutsPerWeek: how many quality interval sessions per week (1-3 typical)
// Remaining ride days each week are filled with zone 2 endurance rides.
// Phases (base/build/peak/taper) are allocated proportionally to durationWeeks.

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

// Total rides/week is fixed at 4 for now (key workouts + zone 2 fillers).
// Worth revisiting as a third input once other plan types exist.
const TOTAL_RIDES_PER_WEEK = 4;

// Preferred day-offset order to assign key workout slots, then filler slots,
// so key sessions land on non-consecutive days where possible.
const DAY_PRIORITY = [1, 3, 5, 6, 2, 4, 0]; // Tue, Thu, Sat, Sun, Wed, Fri, Mon

function endurance(dayOffset: number, minutes: number): WorkoutTemplate {
  return {
    dayOffset,
    title: "Endurance ride",
    description: `${minutes} min steady zone 2 (55-75% FTP), conversational pace.`,
    targetDurationMin: minutes,
    targetTss: Math.round(minutes * 0.6),
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

function sweetSpot(dayOffset: number, reps: number, onMin: number): WorkoutTemplate {
  const totalMin = 15 + reps * (onMin + 5) + 10;
  return {
    dayOffset,
    title: `Sweet spot ${reps}x${onMin}min`,
    description: `Warm up 15min, ${reps} x ${onMin}min @ 88-94% FTP with 5min easy spin recovery between, cool down 10min.`,
    targetDurationMin: totalMin,
    targetTss: Math.round(reps * onMin * 1.0 + totalMin * 0.15),
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
    targetTss: Math.round(reps * onMin * 1.05 + totalMin * 0.15),
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
    targetTss: Math.round(reps * onMin * 1.15 + totalMin * 0.15),
    structure: [
      { type: "warmup", min: 20 },
      { type: "interval", reps, on_min: onMin, on_pct_ftp: [106, 120], off_min: onMin, off_pct_ftp: 50 },
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

// Linear interpolation between a start and end value across a phase's weeks
function lerp(start: number, end: number, weekIdx: number, totalWeeks: number): number {
  if (totalWeeks <= 1) return end;
  return Math.round(start + ((end - start) * weekIdx) / (totalWeeks - 1));
}

// Splits durationWeeks into base/build/peak/taper week counts.
// Taper (incl. FTP retest) is always the final week. Peak and build scale
// with plan length; base absorbs whatever's left. Designed for 6+ week plans;
// short plans (4-5 weeks) collapse peak into build.
function allocatePhases(durationWeeks: number) {
  const taper = 1;
  let remaining = durationWeeks - taper;

  const peak = remaining >= 6 ? Math.max(1, Math.round(remaining * 0.2)) : remaining >= 3 ? 1 : 0;
  remaining -= peak;

  let build = remaining >= 2 ? Math.max(1, Math.round(remaining * 0.45)) : remaining;
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

function buildKeyWorkout(
  phase: "base" | "build" | "peak" | "taper",
  keyIndex: number,
  dayOffset: number,
  weekIdx: number,
  totalWeeksInPhase: number
): WorkoutTemplate {
  // First key workout of the week is the "main" session for the phase;
  // additional key workouts (2nd, 3rd) are lighter/shorter variants.
  const intensityScale = keyIndex === 0 ? 1 : 0.7;

  if (phase === "base") {
    const reps = Math.round(lerp(3, 4, weekIdx, totalWeeksInPhase) * intensityScale) || 2;
    const onMin = lerp(8, 12, weekIdx, totalWeeksInPhase);
    return sweetSpot(dayOffset, Math.max(reps, 2), onMin);
  }
  if (phase === "build") {
    const reps = Math.round(lerp(2, 3, weekIdx, totalWeeksInPhase) * intensityScale) || 2;
    const onMin = lerp(12, 18, weekIdx, totalWeeksInPhase);
    return threshold(dayOffset, Math.max(reps, 2), onMin);
  }
  if (phase === "peak") {
    const reps = Math.round(lerp(4, 6, weekIdx, totalWeeksInPhase) * intensityScale) || 3;
    const onMin = lerp(3, 5, weekIdx, totalWeeksInPhase);
    return vo2max(dayOffset, Math.max(reps, 3), onMin);
  }
  // taper: keep some sharpness, low volume
  return threshold(dayOffset, 2, 8);
}

export function buildFtpBuilderTemplate(durationWeeks: number, keyWorkoutsPerWeek: number): WeekTemplate[] {
  const { base, build, peak, taper } = allocatePhases(durationWeeks);
  const { keyDays, fillerDays } = assignDays(keyWorkoutsPerWeek);
  const weeks: WeekTemplate[] = [];
  let weekNumber = 1;

  const phaseSequence: Array<{ phase: "base" | "build" | "peak" | "taper"; count: number }> = [
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
        keyDays.forEach((d, i) => workouts.push(buildKeyWorkout(phase, i, d, weekIdx, count)));
        fillerDays.forEach((d, i) => {
          // Make the last filler day (typically Sunday) the longer ride
          const isLongDay = i === fillerDays.length - 1;
          if (!isLongDay && i === 0 && phase !== "taper") {
            workouts.push(recovery(d));
          } else {
            const minutes = isLongDay ? 90 + weekIdx * 5 : 60;
            workouts.push(endurance(d, minutes));
          }
        });
      }

      weeks.push({ weekNumber, phase, workouts });
      weekNumber++;
    }
  }

  return weeks;
}
