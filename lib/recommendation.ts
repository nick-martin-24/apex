// WHOOP's own recovery bands: red <34%, yellow 34-66%, green >=67%
export type RecoveryBand = "red" | "yellow" | "green";

export function getRecoveryBand(recoveryScore: number): RecoveryBand {
  if (recoveryScore < 34) return "red";
  if (recoveryScore < 67) return "yellow";
  return "green";
}

// A workout counts as "key" (hard) if its structure includes an interval
// segment at sweet-spot intensity or above (>=88% FTP), a tempo-or-harder
// steady effort (>=76% FTP), or an FTP test. Easy endurance/recovery rides
// don't qualify.
export function isKeyWorkout(structure: any[]): boolean {
  return structure.some(
    (seg) =>
      (seg.type === "interval" && seg.on_pct_ftp?.[0] >= 88) ||
      (seg.type === "steady" && seg.pct_ftp?.[0] >= 76) ||
      seg.type === "test"
  );
}

export type RecommendationAction = "proceed" | "reduce_intensity" | "swap_to_easy" | "rest";

export interface DailyRecommendation {
  recoveryScore: number;
  band: RecoveryBand;
  workoutIsKey: boolean;
  action: RecommendationAction;
  message: string;
}

export function getDailyRecommendation(
  recoveryScore: number,
  plannedWorkout: { title: string; structure: any[] } | null
): DailyRecommendation {
  const band = getRecoveryBand(recoveryScore);

  if (!plannedWorkout) {
    return {
      recoveryScore,
      band,
      workoutIsKey: false,
      action: "proceed",
      message: "No workout scheduled today.",
    };
  }

  const workoutIsKey = isKeyWorkout(plannedWorkout.structure);

  // Green: proceed with plan as written, regardless of workout type.
  if (band === "green") {
    return {
      recoveryScore,
      band,
      workoutIsKey,
      action: "proceed",
      message: `Recovery is green (${recoveryScore}%) — go ahead with "${plannedWorkout.title}" as planned.`,
    };
  }

  // Yellow: proceed if it's already an easy day; suggest dialing back a key day.
  if (band === "yellow") {
    if (workoutIsKey) {
      return {
        recoveryScore,
        band,
        workoutIsKey,
        action: "reduce_intensity",
        message: `Recovery is yellow (${recoveryScore}%) — consider cutting "${plannedWorkout.title}" short or dropping a rep/interval rather than skipping it entirely.`,
      };
    }
    return {
      recoveryScore,
      band,
      workoutIsKey,
      action: "proceed",
      message: `Recovery is yellow (${recoveryScore}%), but today's "${plannedWorkout.title}" is already easy — proceed as planned.`,
    };
  }

  // Red: recommend backing off regardless of what was planned.
  if (workoutIsKey) {
    return {
      recoveryScore,
      band,
      workoutIsKey,
      action: "swap_to_easy",
      message: `Recovery is red (${recoveryScore}%) — swap "${plannedWorkout.title}" for an easy zone 2 spin or full rest day instead.`,
    };
  }
  return {
    recoveryScore,
    band,
    workoutIsKey,
    action: "rest",
    message: `Recovery is red (${recoveryScore}%) — even today's easy "${plannedWorkout.title}" might be worth skipping in favor of full rest.`,
  };
}
