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
