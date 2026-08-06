"use client";

import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  recovery: "Recovery spin",
  endurance: "Endurance ride",
  tempo: "Tempo",
  sweetspot: "Sweet spot",
  threshold: "Threshold",
  vo2max: "VO2max",
  sprints: "Sprints",
};
const INTERVAL_TYPES = new Set(["sweetspot", "threshold", "vo2max", "sprints"]);

export default function AdjustWorkout({ workoutId, date }: { workoutId: number; date: string }) {
  const [swapType, setSwapType] = useState("endurance");
  const [reps, setReps] = useState("3");
  const [onMin, setOnMin] = useState("10");
  const [minutes, setMinutes] = useState("60");
  const [newDate, setNewDate] = useState(date);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function doSwap() {
    setSubmitting(true);
    setStatus("Applying...");
    const body: any = { action: "swap", workout_type: swapType };
    if (INTERVAL_TYPES.has(swapType)) {
      body.reps = reps;
      body.on_min = onMin;
    } else if (swapType !== "recovery") {
      body.minutes = minutes;
    }
    const res = await fetch(`/api/plans/workouts/${workoutId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setStatus("Updated. Reloading...");
      setTimeout(() => window.location.reload(), 700);
    } else {
      setStatus(`Error: ${data.error}`);
    }
  }

  async function doMove() {
    setSubmitting(true);
    setStatus("Moving...");
    const res = await fetch(`/api/plans/workouts/${workoutId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", new_date: newDate }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setStatus(data.swappedWith ? "Swapped with that day's workout. Reloading..." : "Moved. Reloading...");
      setTimeout(() => window.location.reload(), 700);
    } else {
      setStatus(`Error: ${data.error}`);
    }
  }

  return (
    <details className="setup" style={{ marginTop: 12 }}>
      <summary>Adjust this workout</summary>
      <div className="form-row">
        <div className="field-group">
          <h4>Swap type</h4>
          <label>
            Type
            <select value={swapType} onChange={(e) => setSwapType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {INTERVAL_TYPES.has(swapType) && (
            <>
              <label>
                Reps
                <input
                  type="number"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  style={{ width: 50 }}
                  min={1}
                />
              </label>
              <label>
                Min each
                <input
                  type="number"
                  value={onMin}
                  onChange={(e) => setOnMin(e.target.value)}
                  style={{ width: 50 }}
                  min={1}
                />
              </label>
            </>
          )}
          {(swapType === "endurance" || swapType === "tempo") && (
            <label>
              Minutes
              <input
                type="number"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={{ width: 60 }}
                min={10}
              />
            </label>
          )}
          <div>
            <button type="button" disabled={submitting} onClick={doSwap}>
              Apply swap
            </button>
          </div>
        </div>

        <div className="field-group">
          <h4>Move to another day</h4>
          <label>
            Date
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          <div>
            <button type="button" disabled={submitting} onClick={doMove}>
              Move
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            If that day already has a workout, they'll swap places.
          </p>
        </div>
      </div>
      {status && <p className="form-status">{status}</p>}
    </details>
  );
}
