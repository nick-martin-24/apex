"use client";

import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  recovery: "Recovery spin",
  endurance: "Endurance ride",
  group_ride: "Group ride",
};

interface Preview {
  weeks: Array<{ weekNumber: number; tssBefore: number; tssAfter: number; delta: number }>;
  recovery: { available: boolean; band?: string; recoveryScore?: number; message: string; recommended: boolean | null };
  proximity: { message: string; recommended: boolean };
  overall: "recommended" | "caution" | "not_recommended";
}

function PreviewPanel({ preview }: { preview: Preview }) {
  const badgeClass = preview.overall === "recommended" ? "green" : preview.overall === "caution" ? "yellow" : "red";
  return (
    <div style={{ marginTop: 10, padding: 10, background: "var(--surface-2)", borderRadius: 8, fontSize: 13 }}>
      <span className={`assessment-badge ${badgeClass}`}>{preview.overall.replace("_", " ")}</span>
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

export default function AddWorkout({ date }: { date: string }) {
  const [type, setType] = useState("endurance");
  const [minutes, setMinutes] = useState("75");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  function body() {
    const b: any = { workout_type: type };
    if (type !== "recovery") b.minutes = minutes;
    return b;
  }

  async function doPreview() {
    setPreviewLoading(true);
    setPreview(null);
    const res = await fetch(`/api/plans/day/${date}/add-workout/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    const data = await res.json();
    setPreviewLoading(false);
    if (res.ok) setPreview(data);
    else setStatus(`Error: ${data.error}`);
  }

  async function doAdd() {
    setSubmitting(true);
    setStatus("Adding...");
    const res = await fetch(`/api/plans/day/${date}/add-workout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setStatus("Added. Reloading...");
      setTimeout(() => window.location.reload(), 700);
    } else {
      setStatus(`Error: ${data.error}`);
    }
  }

  return (
    <details className="setup" style={{ marginTop: 12 }}>
      <summary>Add a ride to this rest day</summary>
      <div className="field-group" style={{ paddingBottom: 12 }}>
        <label>
          Type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPreview(null);
            }}
          >
            {Object.entries(TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {type !== "recovery" && (
          <label>
            Minutes
            <input
              type="number"
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                setPreview(null);
              }}
              style={{ width: 60 }}
              min={20}
            />
          </label>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={previewLoading} onClick={doPreview}>
            {previewLoading ? "Checking..." : "Preview impact"}
          </button>
          <button type="button" disabled={submitting} onClick={doAdd}>
            Add
          </button>
        </div>
        {preview && <PreviewPanel preview={preview} />}
        {status && <p className="form-status">{status}</p>}
      </div>
    </details>
  );
}
