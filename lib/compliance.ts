import { computeTimeInZones, ZoneResult } from "./zones";
import { computeTargetTss, computeActualTss } from "./tss";

export interface IntervalAssessment {
  targetReps: number;
  achievedReps: number;
  onMin: number;
  pctFtpRange: [number, number];
}

// Detects how many of a planned interval's reps were actually achieved from
// the power stream. Heuristic, not exact science: flags any second at or
// above ~85% of the target interval's midpoint power as "in the effort",
// merges gaps under 15s (brief dips/shifts shouldn't split one real interval
// into two), then counts merged segments that lasted at least 70% of the
// planned interval duration.
function detectAchievedIntervals(
  timeS: number[],
  watts: (number | null)[],
  thresholdWatts: number,
  minDurationSec: number
): number {
  const mergeGapSec = 15;
  const segments: Array<{ start: number; end: number }> = [];
  let segStart: number | null = null;

  for (let i = 0; i < timeS.length; i++) {
    const w = watts[i];
    const isOn = w != null && w >= thresholdWatts;
    if (isOn && segStart === null) segStart = timeS[i];
    if (!isOn && segStart !== null) {
      segments.push({ start: segStart, end: timeS[i - 1] });
      segStart = null;
    }
  }
  if (segStart !== null) segments.push({ start: segStart, end: timeS[timeS.length - 1] });

  const merged: Array<{ start: number; end: number }> = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end <= mergeGapSec) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.filter((s) => s.end - s.start >= minDurationSec).length;
}

function assessIntervals(
  structure: any[],
  stream: { time_s: number[]; watts: (number | null)[] } | null,
  ftp: number | null
): IntervalAssessment | null {
  if (!stream?.time_s || !stream?.watts || !ftp) return null;
  const seg = structure.find((s) => s.type === "interval");
  if (!seg) return null;

  const midPct = (seg.on_pct_ftp[0] + seg.on_pct_ftp[1]) / 2 / 100;
  const thresholdWatts = ftp * midPct * 0.85;
  const minDurationSec = seg.on_min * 60 * 0.7;

  const achieved = detectAchievedIntervals(stream.time_s, stream.watts, thresholdWatts, minDurationSec);

  return {
    targetReps: seg.reps,
    achievedReps: Math.min(achieved, seg.reps + 2), // cap so stray surges don't produce absurd counts
    onMin: seg.on_min,
    pctFtpRange: seg.on_pct_ftp,
  };
}

export interface ComplianceResult {
  duration: {
    targetMin: number;
    actualMin: number;
    compliancePct: number; // actual / target * 100
  };
  tss: {
    targetTss: number;
    actualTss: number | null; // null if no FTP or power data available
    compliancePct: number | null; // actual / target * 100
  };
  intervals: IntervalAssessment | null; // null for non-interval workouts or missing data
  zones: ZoneResult[] | null; // null if no stream data or FTP
}

export interface ComplianceAssessment {
  band: "green" | "yellow" | "red";
  score: number; // 0-100
  summary: string; // written, multi-sentence assessment
}

// Turns the raw duration/TSS/interval numbers into a color band and a
// written verdict. TSS is weighted more heavily than duration alone since it
// captures both duration and intensity together; missed intervals subtract
// directly since executing the actual prescribed efforts is the point of a
// key workout.
export function assessCompliance(result: ComplianceResult): ComplianceAssessment {
  const { duration, tss, intervals } = result;

  let score = 100;
  score -= Math.min(Math.abs(100 - duration.compliancePct) * 0.4, 30);
  if (tss.compliancePct != null) {
    score -= Math.min(Math.abs(100 - tss.compliancePct) * 0.6, 50);
  }
  if (intervals) {
    const missed = Math.max(intervals.targetReps - intervals.achievedReps, 0);
    score -= missed * 10;
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

  // TSS commentary
  if (tss.actualTss == null || tss.compliancePct == null) {
    sentences.push("No FTP or power data was available to compare training load for this ride.");
  } else if (Math.abs(100 - tss.compliancePct) <= 10) {
    sentences.push(`Training load landed right at the plan — ${tss.actualTss} TSS actual vs. ${tss.targetTss} planned.`);
  } else if (tss.compliancePct < 100) {
    sentences.push(
      `Training load came in under plan — ${tss.actualTss} TSS actual vs. ${tss.targetTss} planned (${tss.compliancePct}%).`
    );
  } else {
    sentences.push(
      `Training load came in over plan — ${tss.actualTss} TSS actual vs. ${tss.targetTss} planned (${tss.compliancePct}%).`
    );
  }

  // Interval-achievement commentary
  if (intervals) {
    if (intervals.achievedReps >= intervals.targetReps) {
      sentences.push(
        `All ${intervals.targetReps} planned ${intervals.onMin}min intervals were completed at target intensity.`
      );
    } else {
      sentences.push(
        `${intervals.achievedReps} of ${intervals.targetReps} planned ${intervals.onMin}min intervals were completed at target intensity.`
      );
    }
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
  activity: { moving_time_s: number; avg_watts: number | null; weighted_avg_watts?: number | null },
  stream: { time_s: number[]; watts: (number | null)[] } | null,
  ftp: number | null
): ComplianceResult {
  const actualMin = Math.round(activity.moving_time_s / 60);
  const targetTss = computeTargetTss(plannedWorkout.structure);

  // Prefer Normalized Power when we have it (webhook-ingested rides); fall
  // back to plain average power for backfilled/summary-only rides.
  const powerForTss = activity.weighted_avg_watts ?? activity.avg_watts;
  const actualTss = ftp && powerForTss ? computeActualTss(actualMin, powerForTss, ftp) : null;

  const zones =
    ftp && stream?.time_s && stream?.watts ? computeTimeInZones(stream.time_s, stream.watts, ftp) : null;

  const intervals = assessIntervals(plannedWorkout.structure, stream, ftp);

  return {
    duration: {
      targetMin: plannedWorkout.target_duration_min,
      actualMin,
      compliancePct: Math.round((actualMin / plannedWorkout.target_duration_min) * 100),
    },
    tss: {
      targetTss,
      actualTss,
      compliancePct: actualTss != null ? Math.round((actualTss / targetTss) * 100) : null,
    },
    intervals,
    zones,
  };
}
