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

interface Preview {
  weeks: Array<{ weekNumber: number; tssBefore: number; tssAfter: number; delta: number }>;
  recovery: { available: boolean; band?: string; recoveryScore?: number; message: string; recommended: boolean | null };
  proximity: { message: string; recommended: boolean };
  overall: "recommended" | "caution" | "not_recommended";
}

function PreviewPanel({ preview }: { preview: Preview }) {
  const badgeClass = preview.overall === "recommended" ? "green" : preview.overall === "caution" ? "yellow" : "red";
  const badgeLabel = preview.overall.replace("_", " ");

  return (
    <div style={{ marginTop: 10, padding: 10, background: "var(--surface-2)", borderRadius: 8, fontSize: 13 }}>
      <span className={`assessment-badge ${badgeClass}`} style={{ marginBottom: 8 }}>
        {badgeLabel}
      </span>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {preview.weeks.map((w) => (
          <div key={w.weekNumber} className="mono" style={{ color: "var(--text-muted)" }}>
            Week {w.weekNumber} TSS: {w.tssBefore} → {w.tssAfter} ({w.delta >= 0 ? "+" : ""}
            {w.delta})
          </div>
        ))}
        <div>{preview.recovery.message}</div>
        <div>{preview.proximity.message}</div>
      </div>
    </div>
  );
}

export default function AdjustWorkout({ workoutId, date }: { workoutId: number; date: string }) {
  const [swapType, setSwapType] = useState("endurance");
  const [reps, setReps] = useState("3");
  const [onMin, setOnMin] = useState("10");
  const [minutes, setMinutes] = useState("60");
  const [newDate, setNewDate] = useState(date);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [swapPreview, setSwapPreview] = useState<Preview | null>(null);
  const [movePreview, setMovePreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<"swap" | "move" | null>(null);

  function swapBody() {
    const body: any = { action: "swap", workout_type: swapType };
    if (INTERVAL_TYPES.has(swapType)) {
      body.reps = reps;
      body.on_min = onMin;
    } else if (swapType !== "recovery") {
      body.minutes = minutes;
    }
    return body;
  }

  async function previewSwapImpact() {
    setPreviewLoading("swap");
    setSwapPreview(null);
    const res = await fetch(`/api/plans/workouts/${workoutId}/adjust/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody()),
    });
    const data = await res.json();
    setPreviewLoading(null);
    if (res.ok) setSwapPreview(data);
    else setStatus(`Error: ${data.error}`);
  }

  async function doSwap() {
    setSubmitting(true);
    setStatus("Applying...");
    const res = await fetch(`/api/plans/workouts/${workoutId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody()),
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

  async function previewMoveImpact() {
    setPreviewLoading("move");
    setMovePreview(null);
    const res = await fetch(`/api/plans/workouts/${workoutId}/adjust/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", new_date: newDate }),
    });
    const data = await res.json();
    setPreviewLoading(null);
    if (res.ok) setMovePreview(data);
    else setStatus(`Error: ${data.error}`);
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
            <select
              value={swapType}
              onChange={(e) => {
                setSwapType(e.target.value);
                setSwapPreview(null);
              }}
            >
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
                  onChange={(e) => {
                    setReps(e.target.value);
                    setSwapPreview(null);
                  }}
                  style={{ width: 50 }}
                  min={1}
                />
              </label>
              <label>
                Min each
                <input
                  type="number"
                  value={onMin}
                  onChange={(e) => {
                    setOnMin(e.target.value);
                    setSwapPreview(null);
                  }}
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
                onChange={(e) => {
                  setMinutes(e.target.value);
                  setSwapPreview(null);
                }}
                style={{ width: 60 }}
                min={10}
              />
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={previewLoading === "swap"} onClick={previewSwapImpact}>
              {previewLoading === "swap" ? "Checking..." : "Preview impact"}
            </button>
            <button type="button" disabled={submitting} onClick={doSwap}>
              Apply swap
            </button>
          </div>
          {swapPreview && <PreviewPanel preview={swapPreview} />}
        </div>

        <div className="field-group">
          <h4>Move to another day</h4>
          <label>
            Date
            <input
              type="date"
              value={newDate}
              onChange={(e) => {
                setNewDate(e.target.value);
                setMovePreview(null);
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={previewLoading === "move"} onClick={previewMoveImpact}>
              {previewLoading === "move" ? "Checking..." : "Preview impact"}
            </button>
            <button type="button" disabled={submitting} onClick={doMove}>
              Move
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            If that day already has a workout, they'll swap places.
          </p>
          {movePreview && <PreviewPanel preview={movePreview} />}
        </div>
      </div>
      {status && <p className="form-status">{status}</p>}
    </details>
  );
}
