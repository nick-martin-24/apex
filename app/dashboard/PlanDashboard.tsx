"use client";

import { useState } from "react";
import AdjustWorkout from "./AdjustWorkout";

function zoneColorVar(title: string): string {
  if (title.startsWith("Recovery")) return "var(--z1)";
  if (title.startsWith("Endurance")) return "var(--z2)";
  if (title.startsWith("Tempo")) return "var(--z3)";
  if (title.startsWith("Sweet spot")) return "var(--z4)";
  if (title.startsWith("Threshold")) return "var(--z4)";
  if (title.startsWith("VO2max")) return "var(--z5)";
  if (title.startsWith("Sprints")) return "var(--z7)";
  if (title.startsWith("FTP test")) return "var(--z6)";
  return "var(--z1)";
}

const ZONE_COLORS = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)", "var(--z6)", "var(--z7)"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PHASE_COLORS: Record<string, string> = {
  base: "var(--z2)",
  build: "var(--z4)",
  peak: "var(--z5)",
  taper: "var(--z1)",
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtHoursMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface DayData {
  date: string;
  isToday: boolean;
  recovery: any | null;
  workout: any | null;
  activity: any | null;
  compliance: any | null;
  assessment: any | null;
  recommendation: any | null;
}

interface WeekTile {
  date: string;
  dayName: string;
  workout: any | null;
}

interface WorkoutSummary {
  day_offset: number;
  title: string;
  target_duration_min: number;
  target_tss: number;
  completed_activity_id: string | null;
}

interface WeekGroup {
  weekNumber: number;
  phase: string;
  workouts: WorkoutSummary[];
}

export default function PlanDashboard({
  todayDateStr,
  initialToday,
  weekTiles,
  weekLabel,
  allWeeks,
  planStartDate,
  currentWeekNumber,
}: {
  todayDateStr: string;
  initialToday: DayData;
  weekTiles: WeekTile[];
  weekLabel: string;
  allWeeks: WeekGroup[];
  planStartDate: string;
  currentWeekNumber: number;
}) {
  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [data, setData] = useState<DayData>(initialToday);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState(
    allWeeks.some((w) => w.weekNumber === currentWeekNumber) ? currentWeekNumber : allWeeks[0]?.weekNumber ?? 1
  );

  async function selectDate(date: string) {
    if (date === selectedDate) return;
    if (date === todayDateStr) {
      setSelectedDate(todayDateStr);
      setData(initialToday);
      return;
    }
    setSelectedDate(date);
    setLoading(true);
    try {
      const res = await fetch(`/api/plans/day/${date}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  const dateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const activeTabWeek = allWeeks.find((w) => w.weekNumber === selectedTab);
  const tabWeekStartDate = addDays(planStartDate, (selectedTab - 1) * 7);
  const tabWeekTss = activeTabWeek?.workouts.reduce((sum, w) => sum + (w.target_tss ?? 0), 0) ?? 0;
  const tabWeekMin = activeTabWeek?.workouts.reduce((sum, w) => sum + (w.target_duration_min ?? 0), 0) ?? 0;

  return (
    <>
      <div className="today-card">
        <p className="today-eyebrow">
          {data.isToday ? "Today" : dateLabel}
          {!data.isToday && (
            <>
              {" — "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  selectDate(todayDateStr);
                }}
              >
                back to today
              </a>
            </>
          )}
        </p>

        {loading ? (
          <p className="empty-today">Loading...</p>
        ) : data.isToday ? (
          data.recommendation ? (
            <>
              <div className="today-main">
                <div className="readout">
                  <div className={`readout-value mono ${data.recommendation.band}`}>
                    {data.recommendation.recoveryScore}
                  </div>
                  <div className="readout-label">Recovery %</div>
                </div>
                <div className="today-message">{data.recommendation.message}</div>
              </div>
              {data.workout && <WorkoutMeta workout={data.workout} date={data.date} />}
              {data.workout && !data.workout.completed_activity_id && (
                <AdjustWorkout workoutId={data.workout.id} date={data.date} />
              )}
            </>
          ) : (
            <p className="empty-today">
              {data.workout
                ? `No WHOOP recovery synced yet — today's workout is "${data.workout.title}".`
                : "No workout scheduled today."}
            </p>
          )
        ) : (
          <>
            <div className="stat-row">
              {data.recovery ? (
                <>
                  <div className="stat">
                    <div className="stat-value mono">{data.recovery.recovery_score}%</div>
                    <div className="stat-label">Recovery</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value mono">
                      {data.recovery.hrv_ms != null ? Math.round(data.recovery.hrv_ms) : "—"}
                    </div>
                    <div className="stat-label">HRV (ms)</div>
                  </div>
                </>
              ) : (
                <p className="empty-today">No WHOOP data for this date.</p>
              )}
            </div>
            {data.workout ? <WorkoutMeta workout={data.workout} date={data.date} /> : <p className="empty-today">Rest day.</p>}
            {data.workout && !data.workout.completed_activity_id && (
              <AdjustWorkout workoutId={data.workout.id} date={data.date} />
            )}
            {data.activity && data.compliance && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div className="workout-title">Ride performance — {data.activity.name}</div>
                  {data.assessment && (
                    <span className={`assessment-badge ${data.assessment.band}`}>{data.assessment.band}</span>
                  )}
                </div>
                <div className="stat-row">
                  <div className="stat">
                    <div className="stat-value mono">
                      {data.compliance.duration.actualMin}
                      <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                        {" "}
                        / {data.compliance.duration.targetMin}
                      </span>
                    </div>
                    <div className="stat-label">Duration (min)</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value mono">{data.compliance.duration.compliancePct}%</div>
                    <div className="stat-label">Duration compliance</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value mono">
                      {data.compliance.tss.actualTss ?? "—"}
                      <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                        {" "}
                        / {data.compliance.tss.targetTss}
                      </span>
                    </div>
                    <div className="stat-label">TSS (actual / planned)</div>
                  </div>
                  {data.compliance.tss.compliancePct != null && (
                    <div className="stat">
                      <div className="stat-value mono">{data.compliance.tss.compliancePct}%</div>
                      <div className="stat-label">TSS compliance</div>
                    </div>
                  )}
                  {data.compliance.intervals && (
                    <div className="stat">
                      <div className="stat-value mono">
                        {data.compliance.intervals.achievedReps}
                        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                          {" "}
                          / {data.compliance.intervals.targetReps}
                        </span>
                      </div>
                      <div className="stat-label">Intervals @ target</div>
                    </div>
                  )}
                </div>
                {data.compliance.zones && (
                  <div className="zone-bars">
                    {data.compliance.zones.map((z: any, i: number) => (
                      <div className="zone-bar-row" key={z.zone}>
                        <span className="zone-bar-label">Z{z.zone}</span>
                        <div className="zone-bar-track">
                          <div
                            className="zone-bar-fill"
                            style={{ width: `${z.percentOfRide}%`, background: ZONE_COLORS[i] }}
                          />
                        </div>
                        <span className="zone-bar-pct">{Math.round(z.percentOfRide)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.assessment && <p className="assessment-summary">{data.assessment.summary}</p>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="week-section">
        <div className="week-header">
          <span className="week-title">This week</span>
          <span className="week-phase mono">{weekLabel}</span>
        </div>
        <div className="week-strip">
          {weekTiles.map((tile) => (
            <button
              key={tile.date}
              type="button"
              onClick={() => selectDate(tile.date)}
              className={`day-tile ${tile.date === selectedDate ? "today" : ""} ${!tile.workout ? "rest" : ""}`}
              style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}
            >
              {tile.workout?.completed_activity_id && <span className="day-check">✅</span>}
              {tile.date === todayDateStr && (
                <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 9, color: "var(--accent)" }}>
                  ●
                </span>
              )}
              <div className="day-name mono">{tile.dayName}</div>
              {tile.workout ? (
                <>
                  <div className="day-zone-bar" style={{ background: zoneColorVar(tile.workout.title) }} />
                  <div className="day-label">{tile.workout.title}</div>
                  <div className="day-dur mono">
                    {tile.workout.target_duration_min}min · {tile.workout.target_tss} TSS
                  </div>
                </>
              ) : (
                <div className="day-label" style={{ color: "var(--text-muted)" }}>
                  Rest
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {allWeeks.length > 0 && (
        <div className="week-section">
          <div className="week-header">
            <span className="week-title">Plan overview</span>
            {activeTabWeek && (
              <span className="week-phase mono">
                {activeTabWeek.phase} · {fmtHoursMinutes(tabWeekMin)} · {tabWeekTss} TSS
              </span>
            )}
          </div>

          <div className="week-tabs">
            {allWeeks.map((w) => (
              <button
                key={w.weekNumber}
                type="button"
                className={`week-tab ${w.weekNumber === selectedTab ? "active" : ""}`}
                onClick={() => setSelectedTab(w.weekNumber)}
              >
                <span className="phase-dot" style={{ background: PHASE_COLORS[w.phase] ?? "var(--z1)" }} />
                wk {w.weekNumber}
              </button>
            ))}
          </div>

          {activeTabWeek && (
            <div className="week-strip">
              {Array.from({ length: 7 }, (_, i) => {
                const workout = activeTabWeek.workouts.find((w) => w.day_offset === i) ?? null;
                const date = addDays(tabWeekStartDate, i);
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => selectDate(date)}
                    className={`day-tile ${date === selectedDate ? "today" : ""} ${!workout ? "rest" : ""}`}
                    style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}
                  >
                    {workout?.completed_activity_id && <span className="day-check">✅</span>}
                    {date === todayDateStr && (
                      <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 9, color: "var(--accent)" }}>
                        ●
                      </span>
                    )}
                    <div className="day-name mono">{DAY_NAMES[i]}</div>
                    {workout ? (
                      <>
                        <div className="day-zone-bar" style={{ background: zoneColorVar(workout.title) }} />
                        <div className="day-label">{workout.title}</div>
                        <div className="day-dur mono">
                          {workout.target_duration_min}min · {workout.target_tss} TSS
                        </div>
                      </>
                    ) : (
                      <div className="day-label" style={{ color: "var(--text-muted)" }}>
                        Rest
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function WorkoutMeta({ workout, date }: { workout: any; date: string }) {
  return (
    <div className="today-workout">
      <div>
        <div className="workout-title">{workout.title}</div>
        <div className="workout-desc">{workout.description}</div>
      </div>
      <div className="workout-meta mono">
        {workout.target_duration_min}min · ~{workout.target_tss} TSS
        {workout.completed_activity_id && (
          <>
            {" "}
            · ✅ <a href={`/dashboard/day/${date}`}>compliance</a>
          </>
        )}
      </div>
    </div>
  );
}
