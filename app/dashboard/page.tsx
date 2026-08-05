import { pool } from "@/lib/db";
import { getToken } from "@/lib/tokens";
import PlanForm from "./PlanForm";

// This page hits the database directly, so it can't be statically
// pre-rendered at build time — force it to run per-request instead.
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [stravaToken, whoopToken] = await Promise.all([
    getToken("strava"),
    getToken("whoop"),
  ]);

  const { rows: activities } = await pool.query(
    "select * from activities order by start_date desc limit 5"
  );
  const { rows: recovery } = await pool.query(
    "select * from recovery_days order by date desc limit 5"
  );
  const { rows: settingsRows } = await pool.query(
    "select ftp_watts from athlete_settings where id = true"
  );
  const currentFtp: number | null = settingsRows[0]?.ftp_watts ?? null;

  const { rows: planRows } = await pool.query(
    "select * from plans where status = 'active' order by created_at desc limit 1"
  );
  const activePlan = planRows[0] ?? null;

  let thisWeekWorkouts: any[] = [];
  let recentCompletedWorkouts: any[] = [];
  if (activePlan) {
    const today = new Date().toISOString().slice(0, 10);
    const { rows: currentWeekRow } = await pool.query(
      `select week_number, phase from planned_workouts
       where plan_id = $1 and scheduled_date <= $2
       order by scheduled_date desc limit 1`,
      [activePlan.id, today]
    );
    const weekNumber = currentWeekRow[0]?.week_number ?? 1;
    const { rows } = await pool.query(
      `select * from planned_workouts where plan_id = $1 and week_number = $2 order by scheduled_date asc`,
      [activePlan.id, weekNumber]
    );
    thisWeekWorkouts = rows;

    const { rows: completedRows } = await pool.query(
      `select * from planned_workouts
       where plan_id = $1 and completed_activity_id is not null
       order by scheduled_date desc limit 10`,
      [activePlan.id]
    );
    recentCompletedWorkouts = completedRows;
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Apex</h1>

      <section>
        <h2>Connections</h2>
        <p>
          Strava: {stravaToken ? "connected ✅" : <a href="/api/auth/strava">Connect</a>}
        </p>
        <p>
          WHOOP: {whoopToken ? "connected ✅" : <a href="/api/auth/whoop">Connect</a>}
        </p>
        {stravaToken && (
          <p>
            <a href="/api/backfill/strava?limit=100">Backfill last 100 Strava rides</a>
          </p>
        )}
        {whoopToken && (
          <p>
            <a href="/api/backfill/whoop?limit=90">Backfill last 90 days of WHOOP recovery</a>
          </p>
        )}
      </section>

      <section>
        <h2>Training plan</h2>
        <PlanForm currentFtp={currentFtp} />

        {activePlan ? (
          <div>
            <p>
              Active plan: <strong>{activePlan.type}</strong> — started {activePlan.start_date?.toISOString?.().slice(0, 10)}{" "}
              — {activePlan.duration_weeks} weeks, {activePlan.key_workouts_per_week} key workouts/week, ~
              {activePlan.target_weekly_hours}h/week target
              {" — "}
              <a href="/api/plans/rematch">Rematch existing rides to plan</a>
            </p>
            <h3>This week</h3>
            <ul>
              {thisWeekWorkouts.map((w) => (
                <li key={w.id}>
                  [{w.phase}] {w.scheduled_date?.toISOString?.().slice(0, 10)} — <strong>{w.title}</strong> —{" "}
                  {w.target_duration_min}min, ~{w.target_tss} TSS
                  {w.completed_activity_id ? (
                    <>
                      {" "}
                      ✅ <a href={`/api/plans/workouts/${w.id}/compliance`}>view compliance</a>
                    </>
                  ) : (
                    ""
                  )}
                </li>
              ))}
            </ul>

            <h3>Recently completed</h3>
            <ul>
              {recentCompletedWorkouts.map((w) => (
                <li key={w.id}>
                  [{w.phase}] {w.scheduled_date?.toISOString?.().slice(0, 10)} — <strong>{w.title}</strong> — ✅{" "}
                  <a href={`/api/plans/workouts/${w.id}/compliance`}>view compliance</a>
                </li>
              ))}
              {recentCompletedWorkouts.length === 0 && <li>No completed workouts linked yet.</li>}
            </ul>
          </div>
        ) : (
          <p>No active plan yet — use the form above to create one.</p>
        )}
      </section>

      <section>
        <h2>Recent rides</h2>
        <ul>
          {activities.map((a) => (
            <li key={a.id}>
              {a.name} — {a.start_date?.toISOString?.().slice(0, 10)} —{" "}
              {a.avg_watts ? `${Math.round(a.avg_watts)}W avg` : "no power"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Recent recovery</h2>
        <ul>
          {recovery.map((r) => (
            <li key={r.date}>
              {r.date?.toISOString?.().slice(0, 10)} — recovery {r.recovery_score}% — HRV {r.hrv_ms}ms
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
