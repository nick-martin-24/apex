// Standard TSS formula applied per-segment and summed:
//   TSS = duration_hours × IF² × 100
// where IF (Intensity Factor) is the segment's %FTP as a decimal.
// This replaces ad-hoc per-workout-type approximations with the actual
// formula used by TrainingPeaks/intervals.icu, applied to each segment type
// our workout structures use (warmup/cooldown/steady/interval on+off/test).
export function computeTargetTss(structure: any[]): number {
  let tss = 0;

  for (const seg of structure) {
    if (seg.type === "warmup" || seg.type === "cooldown") {
      const ifVal = 0.5; // easy spin, ~50% FTP
      tss += (seg.min / 60) * ifVal * ifVal * 100;
    } else if (seg.type === "steady") {
      const ifVal = (seg.pct_ftp[0] + seg.pct_ftp[1]) / 2 / 100;
      tss += (seg.min / 60) * ifVal * ifVal * 100;
    } else if (seg.type === "interval") {
      const onIf = (seg.on_pct_ftp[0] + seg.on_pct_ftp[1]) / 2 / 100;
      const onHours = (seg.reps * seg.on_min) / 60;
      tss += onHours * onIf * onIf * 100;

      const offIf = seg.off_pct_ftp / 100;
      const offHours = (seg.reps * seg.off_min) / 60;
      tss += offHours * offIf * offIf * 100;
    } else if (seg.type === "test") {
      const ifVal = 1.0; // FTP test is by definition ~100% IF
      tss += (seg.min / 60) * ifVal * ifVal * 100;
    }
  }

  return Math.round(tss);
}
