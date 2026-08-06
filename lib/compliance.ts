import { COGGAN_ZONES, computeTimeInZones, ZoneResult } from "./zones";

// Estimates the intended average %FTP for a workout from its structure,
// weighting each segment (warmup/cooldown/steady/interval on+off/test) by
// its duration. Used as the "target intensity" to compare actual avg power against.
export function estimateTargetPctFtp(structure: any[]): number {
  let weightedSum = 0;
  let totalMin = 0;

  for (const seg of structure) {
    if (seg.type === "warmup" || seg.type === "cooldown") {
      weightedSum += 50 * seg.min;
      totalMin += seg.min;
    } else if (seg.type === "steady") {
      const mid = (seg.pct_ftp[0] + seg.pct_ftp[1]) / 2;
      weightedSum += mid * seg.min;
      totalMin += seg.min;
    } else if (seg.type === "interval") {
      const onMid = (seg.on_pct_ftp[0] + seg.on_pct_ftp[1]) / 2;
      const onMin = seg.reps * seg.on_min;
      weightedSum += onMid * onMin;
      totalMin += onMin;

      const offMin = seg.reps * seg.off_min;
      weightedSum += seg.off_pct_ftp * offMin;
      totalMin += offMin;
    } else if (seg.type === "test") {
      weightedSum += 100 * seg.min;
      totalMin += seg.min;
    }
  }

  return totalMin > 0 ? Math.round(weightedSum / totalMin) : 0;
}

export interface ComplianceResult {
  duration: {
    targetMin: number;
    actualMin: number;
    compliancePct: number; // actual / target * 100
  };
  intensity: {
    targetPctFtp: number;
    actualPctFtp: number | null; // null if no FTP or avg_watts available
    deltaPct: number | null; // actual - target
  };
  zones: ZoneResult[] | null; // null if no stream data or FTP
}

export interface ComplianceAssessment {
  band: "green" | "yellow" | "red";
  score: number; // 0-100
  summary: string; // written, multi-sentence assessment
}

// Turns the raw duration/intensity numbers into a color band and a written
// verdict. Duration and intensity are scored separately then combined —
// intensity is weighted more heavily since riding at the wrong effort
// matters more physiologically than running a session a few minutes long.
export function assessCompliance(result: ComplianceResult): ComplianceAssessment {
  const { duration, intensity } = result;

  let score = 100;
  score -= Math.min(Math.abs(100 - duration.compliancePct) * 0.6, 50);
  if (intensity.deltaPct != null) {
    score -= Math.min(Math.abs(intensity.deltaPct) * 2.5, 50);
  }
  score = Math.max(0, Math.round(score));

  const band: ComplianceAssessment["band"] = score >= 80 ? "green" : score >= 55 ? "yellow" : "red";

  const sentences: string[] = [];

  // Duration commentary
  if (duration.compliancePct >= 90 && duration.compliancePct <= 112) {
    sentences.push(
      `You completed ${duration.actualMin} of the planned ${duration.targetMin} minutes (${duration.compliancePct}%) — right on target for duration.`
    );
  } else if (duration.compliancePct < 90) {
    sentences.push(
      `You completed ${duration.actualMin} of the planned ${duration.targetMin} minutes (${duration.compliancePct}%) — noticeably shorter than prescribed.`
    );
  } else {
    sentences.push(
      `You rode ${duration.actualMin} minutes against a ${duration.targetMin}-minute target (${duration.compliancePct}%) — longer than planned.`
    );
  }

  // Intensity commentary
  if (intensity.deltaPct == null) {
    sentences.push("No FTP or power data was available to assess intensity for this ride.");
  } else if (Math.abs(intensity.deltaPct) <= 4) {
    sentences.push(`Average intensity landed right at the ${intensity.targetPctFtp}% FTP target.`);
  } else if (intensity.deltaPct < 0) {
    sentences.push(
      `Average intensity came in ${Math.abs(intensity.deltaPct)}% below the ${intensity.targetPctFtp}% FTP target — this session ran easier than prescribed.`
    );
  } else {
    sentences.push(
      `Average intensity ran ${intensity.deltaPct}% above the ${intensity.targetPctFtp}% FTP target — this session ran harder than prescribed.`
    );
  }

  // Overall verdict
  if (band === "green") {
    sentences.push("Overall: strong, faithful execution of this workout.");
  } else if (band === "yellow") {
    sentences.push("Overall: reasonably close to the prescription, with some room to tighten up execution next time.");
  } else {
    sentences.push(
      "Overall: this ride diverged significantly from what was planned — worth a look at what got in the way (fatigue, time, terrain) before the next key session."
    );
  }

  return { band, score, summary: sentences.join(" ") };
}

export function computeCompliance(
  plannedWorkout: { target_duration_min: number; structure: any[] },
  activity: { moving_time_s: number; avg_watts: number | null },
  stream: { time_s: number[]; watts: (number | null)[] } | null,
  ftp: number | null
): ComplianceResult {
  const actualMin = Math.round(activity.moving_time_s / 60);
  const targetPctFtp = estimateTargetPctFtp(plannedWorkout.structure);

  const actualPctFtp = ftp && activity.avg_watts ? Math.round((activity.avg_watts / ftp) * 100) : null;

  const zones =
    ftp && stream?.time_s && stream?.watts ? computeTimeInZones(stream.time_s, stream.watts, ftp) : null;

  return {
    duration: {
      targetMin: plannedWorkout.target_duration_min,
      actualMin,
      compliancePct: Math.round((actualMin / plannedWorkout.target_duration_min) * 100),
    },
    intensity: {
      targetPctFtp,
      actualPctFtp,
      deltaPct: actualPctFtp != null ? actualPctFtp - targetPctFtp : null,
    },
    zones,
  };
}
