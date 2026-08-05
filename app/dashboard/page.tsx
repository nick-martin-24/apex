import { pool } from "@/lib/db";
import { getToken } from "@/lib/tokens";
import { getDailyRecommendation } from "@/lib/recommendation";
import PlanForm from "./PlanForm";
import WeekTabs from "./WeekTabs";

// This page hits the database directly, so it can't be statically
// pre-rendered at build time — force it to run per-request instead.
export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function zoneColorVar(title: string): string {
  if (title.startsWith("Recovery")) return "var(--z1)";
  if (title.startsWith("Endurance")) return "var(--z2)";
  if (title.startsWith("Sweet spot")) return "var(--z3)";
  if (title.startsWith("Threshold")) return "var(--z4)";
  if (title.startsWith("VO2max")) return "var(--z5)";
  if (title.startsWith("FTP test")) return "var(--z6)";
  return "var(--z1)";
}

function fmtDate(d: any): string {
  return d?.toISOString?.().slice(0, 10) ?? String(d).slice(0, 10);
}

export default async function Dashboard() {
  const [stravaToken, whoopToken] = await Promise.all([getToken("strava"), getToken("whoop")]);

  const { rows: activities } = await pool.query("select * from activities order by start_date desc limit 5");
  const { rows: recovery } = await pool.query("select * from recovery_days order by date desc limit 5");
  const { rows: settingsRows } = await pool.query("select ftp_watts from athlete_settings where id = true");
  const currentFtp: number | null = settingsRows[0]?.ftp_watts ?? null;

  const { rows: planRows } = await pool.query(
    "select * from plans where status = 'active' order by created_at desc limit 1"
  );
  const activePlan = planRows[0] ?? null;

  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);

  let todayRecommendation: any = null;
  let todayWorkout: any = null;
  let weekTiles: Array<{ date: string; dayName: string; isToday: boolean; workout: any | null }> = [];
  let weekLabel = "";
  let currentWeekNumber = 1;
  let recentCompletedWorkouts: any[] = [];
  let allWeeks: Array<{ weekNumber: number; phase: string; workouts: any[] }> = [];

  if (activePlan) {
    // Monday of the current calendar week — plan start_date is required to be
    // a Monday, so calendar weeks and plan weeks stay aligned.
    const jsDay = todayDate.getDay(); // 0=Sun
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    const monday = new Date(todayDate);
    monday.setDate(monday.getDate() + mondayOffset);

    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    const [{ rows: recoveryRows }, { rows: weekWorkouts }] = await Promise.all([
      pool.query("select recovery_score from recovery_days where date = $1", [today]),
      pool.query(
        `select * from planned_workouts where plan_id = $1 and scheduled_date between $2 and $3 order by scheduled_date asc`,
        [activePlan.id, weekDates[0], weekDates[6]]
      ),
    ]);

    todayWorkout = weekWorkouts.find((w: any) => fmtDate(w.scheduled_date) === today) ?? null;

    if (recoveryRows.length > 0) {
      todayRecommendation = getDailyRecommendation(Number(recoveryRows[0].recovery_score), todayWorkout);
    }

    weekTiles = weekDates.map((date, i) => ({
      date,
      dayName: DAY_NAMES[i],
      isToday: date === today,
      workout: weekWorkouts.find((w: any) => fmtDate(w.scheduled_date) === date) ?? null,
    }));

    if (weekWorkouts.length > 0) {
      weekLabel = `${weekWorkouts[0].phase} · week ${weekWorkouts[0].week_number}/${activePlan.duration_weeks}`;
      currentWeekNumber = weekWorkouts[0].week_number;
    }

    const { rows: completedRows } = await pool.query(
      `select * from planned_workouts
       where plan_id = $1 and completed_activity_id is not null
       order by scheduled_date desc limit 6`,
      [activePlan.id]
    );
    recentCompletedWorkouts = completedRows;

    const { rows: everyWorkout } = await pool.query(
      `select week_number, phase, day_offset, title, target_duration_min, completed_activity_id
       from planned_workouts where plan_id = $1 order by scheduled_date asc`,
      [activePlan.id]
    );
    const grouped = new Map<number, { weekNumber: number; phase: string; workouts: any[] }>();
    for (const w of everyWorkout) {
      if (!grouped.has(w.week_number)) {
        grouped.set(w.week_number, { weekNumber: w.week_number, phase: w.phase, workouts: [] });
      }
      grouped.get(w.week_number)!.workouts.push(w);
    }
    allWeeks = Array.from(grouped.values()).sort((a, b) => a.weekNumber - b.weekNumber);
  }

  return (
    <main className="page">
      <div className="top-row">
        <div className="brand">Apex</div>
        <div className="conn-pills">
          <span className={`pill ${stravaToken ? "connected" : ""}`}>
            {stravaToken ? "● Strava" : <a href="/api/auth/strava">Connect Strava</a>}
          </span>
          <span className={`pill ${whoopToken ? "connected" : ""}`}>
            {whoopToken ? "● WHOOP" : <a href="/api/auth/whoop">Connect WHOOP</a>}
          </span>
        </div>
      </div>

      {activePlan ? (
        <>
          <div className="today-card">
            <p className="today-eyebrow">
              Today ·{" "}
              {todayDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>

            {todayRecommendation ? (
              <>
                <div className="today-main">
                  <div className="readout">
                    <div className={`readout-value mono ${todayRecommendation.band}`}>
                      {todayRecommendation.recoveryScore}
                    </div>
                    <div className="readout-label">Recovery %</div>
                  </div>
                  <div className="today-message">{todayRecommendation.message}</div>
                </div>

                {todayWorkout && (
                  <div className="today-workout">
                    <div>
                      <div className="workout-title">{todayWorkout.title}</div>
                      <div className="workout-desc">{todayWorkout.description}</div>
                    </div>
                    <div className="workout-meta mono">
                      {todayWorkout.target_duration_min}min · ~{todayWorkout.target_tss} TSS
                      {todayWorkout.completed_activity_id && (
                        <>
                          {" "}
                          · ✅{" "}
                          <a href={`/api/plans/workouts/${todayWorkout.id}/compliance`}>compliance</a>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="empty-today">
                {todayWorkout
                  ? `No WHOOP recovery synced yet — today's workout is "${todayWorkout.title}".`
                  : "No workout scheduled today."}
              </p>
            )}
          </div>

          <div className="week-section">
            <div className="week-header">
              <span className="week-title">This week</span>
              <span className="week-phase mono">{weekLabel}</span>
            </div>
            <div className="week-strip">
              {weekTiles.map((tile) => (
                <a
                  key={tile.date}
                  href={`/dashboard/day/${tile.date}`}
                  className={`day-tile ${tile.isToday ? "today" : ""} ${!tile.workout ? "rest" : ""}`}
                >
                  {tile.workout?.completed_activity_id && <span className="day-check">✅</span>}
                  <div className="day-name mono">{tile.dayName}</div>
                  {tile.workout ? (
                    <>
                      <div
                        className="day-zone-bar"
                        style={{ background: zoneColorVar(tile.workout.title) }}
                      />
                      <div className="day-label">{tile.workout.title}</div>
                      <div className="day-dur mono">{tile.workout.target_duration_min}min</div>
                    </>
                  ) : (
                    <div className="day-label" style={{ color: "var(--text-muted)" }}>
                      Rest
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>

          {allWeeks.length > 0 && (
            <WeekTabs weeks={allWeeks} planStartDate={fmtDate(activePlan.start_date)} currentWeekNumber={currentWeekNumber} />
          )}
        </>
      ) : (
        <div className="today-card">
          <p className="empty-today">No active plan yet — set one up below.</p>
        </div>
      )}

      <div className="secondary-grid">
        <div className="panel">
          <h3>Recently completed</h3>
          <ul className="list">
            {recentCompletedWorkouts.map((w) => (
              <li key={w.id}>
                <span>{w.title}</span>
                <span className="muted">
                  {fmtDate(w.scheduled_date)} ·{" "}
                  <a href={`/api/plans/workouts/${w.id}/compliance`}>compliance</a>
                </span>
              </li>
            ))}
            {recentCompletedWorkouts.length === 0 && <li className="muted">Nothing linked yet.</li>}
          </ul>
        </div>

        <div className="panel">
          <h3>Recent rides</h3>
          <ul className="list">
            {activities.map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <span className="muted">
                  {fmtDate(a.start_date)} {a.avg_watts ? `· ${Math.round(a.avg_watts)}W` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Recent recovery</h3>
          <ul className="list">
            {recovery.map((r) => (
              <li key={r.date}>
                <span>{fmtDate(r.date)}</span>
                <span className="muted">
                  {r.recovery_score}% · HRV {r.hrv_ms}ms
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Backfill</h3>
          <ul className="list">
            {stravaToken && (
              <li>
                <a href="/api/backfill/strava?limit=100">Backfill last 100 Strava rides</a>
              </li>
            )}
            {whoopToken && (
              <li>
                <a href="/api/backfill/whoop?limit=90">Backfill last 90 days of WHOOP recovery</a>
              </li>
            )}
            {activePlan && (
              <li>
                <a href="/api/plans/rematch">Rematch existing rides to plan</a>
              </li>
            )}
          </ul>
        </div>
      </div>

      <details className="setup">
        <summary>Plan setup &amp; FTP</summary>
        <PlanForm currentFtp={currentFtp} />
        {activePlan && (
          <p className="form-status">
            Active: {activePlan.type} · started {fmtDate(activePlan.start_date)} · {activePlan.duration_weeks}{" "}
            weeks · {activePlan.key_workouts_per_week} key workouts/week · ~{activePlan.target_weekly_hours}
            h/week
          </p>
        )}
      </details>
    </main>
  );
}
