import { pool } from "@/lib/db";
import { computeCompliance, assessCompliance } from "@/lib/compliance";

export const dynamic = "force-dynamic";

const ZONE_COLORS = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)", "var(--z6)", "var(--z7)"];

export default async function DayDetail({ params }: { params: { date: string } }) {
  const { date } = params;

  const [{ rows: planRows }, { rows: recoveryRows }] = await Promise.all([
    pool.query("select * from plans where status = 'active' order by created_at desc limit 1"),
    pool.query("select * from recovery_days where date = $1", [date]),
  ]);
  const activePlan = planRows[0] ?? null;
  const recovery = recoveryRows[0] ?? null;

  let workout: any = null;
  let activity: any = null;
  let compliance: any = null;
  let assessment: any = null;

  if (activePlan) {
    const { rows } = await pool.query(
      "select * from planned_workouts where plan_id = $1 and scheduled_date = $2 limit 1",
      [activePlan.id, date]
    );
    workout = rows[0] ?? null;
  }

  if (workout?.completed_activity_id) {
    const [{ rows: activityRows }, { rows: streamRows }, { rows: settingsRows }] = await Promise.all([
      pool.query("select * from activities where id = $1", [workout.completed_activity_id]),
      pool.query("select time_s, watts from activity_streams where activity_id = $1", [
        workout.completed_activity_id,
      ]),
      pool.query("select ftp_watts from athlete_settings where id = true"),
    ]);
    activity = activityRows[0] ?? null;
    const ftp = settingsRows[0]?.ftp_watts ?? null;
    const stream = streamRows[0] ?? null;

    if (activity) {
      compliance = computeCompliance(
        { target_duration_min: workout.target_duration_min, structure: workout.structure },
        { moving_time_s: activity.moving_time_s, avg_watts: activity.avg_watts, weighted_avg_watts: activity.weighted_avg_watts },
        stream,
        ftp
      );
      assessment = assessCompliance(compliance);
    }
  }

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="page">
      <a className="back-link" href="/dashboard">
        ← Back to dashboard
      </a>
      <p className="today-eyebrow">{dateLabel}</p>

      <div className="detail-grid">
        <div className="panel">
          <h3>Recovery</h3>
          {recovery ? (
            <div className="stat-row">
              <div className="stat">
                <div className="stat-value mono">{recovery.recovery_score}%</div>
                <div className="stat-label">Recovery</div>
              </div>
              <div className="stat">
                <div className="stat-value mono">{recovery.hrv_ms != null ? Math.round(recovery.hrv_ms) : "—"}</div>
                <div className="stat-label">HRV (ms)</div>
              </div>
              <div className="stat">
                <div className="stat-value mono">{recovery.resting_hr ?? "—"}</div>
                <div className="stat-label">Resting HR</div>
              </div>
            </div>
          ) : (
            <p className="empty-today">No WHOOP data for this date.</p>
          )}
        </div>

        <div className="panel">
          <h3>Planned workout</h3>
          {workout ? (
            <>
              <div className="workout-title">{workout.title}</div>
              <p className="workout-desc">{workout.description}</p>
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-value mono">{workout.target_duration_min}</div>
                  <div className="stat-label">Target min</div>
                </div>
                <div className="stat">
                  <div className="stat-value mono">{workout.target_tss}</div>
                  <div className="stat-label">Target TSS</div>
                </div>
              </div>
            </>
          ) : (
            <p className="empty-today">Rest day — nothing scheduled.</p>
          )}
        </div>
      </div>

      {activity && compliance && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Ride performance — {activity.name}</h3>
            {assessment && <span className={`assessment-badge ${assessment.band}`}>{assessment.band}</span>}
          </div>
          <div className="stat-row">
            <div className="stat">
              <div className="stat-value mono">
                {compliance.duration.actualMin}
                <span style={{ fontSize: 14, color: "var(--text-muted)" }}> / {compliance.duration.targetMin}</span>
              </div>
              <div className="stat-label">Duration (actual / target min)</div>
            </div>
            <div className="stat">
              <div className="stat-value mono">{compliance.duration.compliancePct}%</div>
              <div className="stat-label">Duration compliance</div>
            </div>
            <div className="stat">
              <div className="stat-value mono">
                {compliance.tss.actualTss ?? "—"}
                <span style={{ fontSize: 14, color: "var(--text-muted)" }}> / {compliance.tss.targetTss}</span>
              </div>
              <div className="stat-label">TSS (actual / planned)</div>
            </div>
            {compliance.tss.compliancePct != null && (
              <div className="stat">
                <div className="stat-value mono">{compliance.tss.compliancePct}%</div>
                <div className="stat-label">TSS compliance</div>
              </div>
            )}
            {compliance.intervals && (
              <div className="stat">
                <div className="stat-value mono">
                  {compliance.intervals.achievedReps}
                  <span style={{ fontSize: 14, color: "var(--text-muted)" }}> / {compliance.intervals.targetReps}</span>
                </div>
                <div className="stat-label">Intervals @ target</div>
              </div>
            )}
          </div>

          {compliance.zones && (
            <div className="zone-bars">
              {compliance.zones.map((z: any, i: number) => (
                <div className="zone-bar-row" key={z.zone}>
                  <span className="zone-bar-label">Z{z.zone}</span>
                  <div className="zone-bar-track">
                    <div
                      className="zone-bar-fill"
                      style={{
                        width: `${z.percentOfRide}%`,
                        background: ZONE_COLORS[i],
                      }}
                    />
                  </div>
                  <span className="zone-bar-pct">{Math.round(z.percentOfRide)}%</span>
                </div>
              ))}
            </div>
          )}

          {assessment && <p className="assessment-summary">{assessment.summary}</p>}
        </div>
      )}
    </main>
  );
}
