"use client";

import { useState } from "react";

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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PHASE_COLORS: Record<string, string> = {
  base: "var(--z2)",
  build: "var(--z4)",
  peak: "var(--z5)",
  taper: "var(--z1)",
};

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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function WeekTabs({
  weeks,
  planStartDate,
  currentWeekNumber,
}: {
  weeks: WeekGroup[];
  planStartDate: string;
  currentWeekNumber: number;
}) {
  const [selected, setSelected] = useState(
    weeks.some((w) => w.weekNumber === currentWeekNumber) ? currentWeekNumber : weeks[0]?.weekNumber ?? 1
  );

  const activeWeek = weeks.find((w) => w.weekNumber === selected);
  const weekStartDate = addDays(planStartDate, (selected - 1) * 7);
  const activeWeekTss = activeWeek?.workouts.reduce((sum, w) => sum + (w.target_tss ?? 0), 0) ?? 0;

  return (
    <div className="week-section">
      <div className="week-header">
        <span className="week-title">Plan overview</span>
        {activeWeek && (
          <span className="week-phase mono">
            {activeWeek.phase} · {activeWeekTss} TSS
          </span>
        )}
      </div>

      <div className="week-tabs">
        {weeks.map((w) => (
          <button
            key={w.weekNumber}
            type="button"
            className={`week-tab ${w.weekNumber === selected ? "active" : ""}`}
            onClick={() => setSelected(w.weekNumber)}
          >
            <span className="phase-dot" style={{ background: PHASE_COLORS[w.phase] ?? "var(--z1)" }} />
            wk {w.weekNumber}
          </button>
        ))}
      </div>

      {activeWeek && (
        <div className="week-strip">
          {Array.from({ length: 7 }, (_, i) => {
            const workout = activeWeek.workouts.find((w) => w.day_offset === i) ?? null;
            const date = addDays(weekStartDate, i);
            return (
              <a key={date} href={`/dashboard/day/${date}`} className={`day-tile ${!workout ? "rest" : ""}`}>
                {workout?.completed_activity_id && <span className="day-check">✅</span>}
                <div className="day-name mono">{DAY_NAMES[i]}</div>
                {workout ? (
                  <>
                    <div className="day-zone-bar" style={{ background: zoneColorVar(workout.title) }} />
                    <div className="day-label">{workout.title}</div>
                    <div className="day-dur mono">{workout.target_duration_min}min</div>
                  </>
                ) : (
                  <div className="day-label" style={{ color: "var(--text-muted)" }}>
                    Rest
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
