"use client";

import { useState } from "react";

interface Preview {
  weeks: Array<{ weekNumber: number; tssBefore: number; tssAfter: number; delta: number }>;
  recovery: { message: string };
  proximity: { message: string };
  overall: "recommended" | "caution" | "not_recommended";
}

function describeAction(action: any): string {
  if (action.action === "swap") {
    return `Swap workout #${action.workout_id} to ${action.workout_type}${action.minutes ? ` (${action.minutes}min)` : ""}${action.reps ? ` — ${action.reps}x${action.on_min ?? "?"}min` : ""}`;
  }
  if (action.action === "move") {
    return `Move workout #${action.workout_id} to ${action.new_date}`;
  }
  if (action.action === "add") {
    return `Add ${action.workout_type}${action.minutes ? ` (${action.minutes}min)` : ""} on ${action.date}`;
  }
  return "Proposed change";
}

export default function CoachCheckin() {
  const [checkin, setCheckin] = useState<string | null>(null);
  const [proposedAction, setProposedAction] = useState<any | null>(null);
  const [actionPreview, setActionPreview] = useState<Preview | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  async function getCheckin() {
    setLoading(true);
    setError(null);
    setApplyStatus(null);
    try {
      const res = await fetch("/api/coach/checkin");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate check-in");
      } else {
        setCheckin(data.checkin);
        setProposedAction(data.proposedAction);
        setActionPreview(data.actionPreview);
        setGeneratedAt(data.generatedAt);
      }
    } catch {
      setError("Failed to reach the coach endpoint.");
    } finally {
      setLoading(false);
    }
  }

  async function applyAction() {
    if (!proposedAction) return;
    setApplying(true);
    setApplyStatus("Applying...");
    try {
      let res: Response;
      if (proposedAction.action === "swap") {
        res = await fetch(`/api/plans/workouts/${proposedAction.workout_id}/adjust`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "swap",
            workout_type: proposedAction.workout_type,
            reps: proposedAction.reps,
            on_min: proposedAction.on_min,
            minutes: proposedAction.minutes,
          }),
        });
      } else if (proposedAction.action === "move") {
        res = await fetch(`/api/plans/workouts/${proposedAction.workout_id}/adjust`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "move", new_date: proposedAction.new_date }),
        });
      } else if (proposedAction.action === "add") {
        res = await fetch(`/api/plans/day/${proposedAction.date}/add-workout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workout_type: proposedAction.workout_type, minutes: proposedAction.minutes }),
        });
      } else {
        setApplyStatus("Unknown action type.");
        setApplying(false);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setApplyStatus("Applied. Reloading...");
        setTimeout(() => window.location.reload(), 700);
      } else {
        setApplyStatus(`Error: ${data.error}`);
        setApplying(false);
      }
    } catch {
      setApplyStatus("Failed to apply.");
      setApplying(false);
    }
  }

  return (
    <div className="panel coach-panel" style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Coach check-in</h3>
        <button type="button" onClick={getCheckin} disabled={loading}>
          {loading ? "Thinking..." : checkin ? "Refresh" : "Get check-in"}
        </button>
      </div>

      {error && <p className="empty-today" style={{ color: "var(--red)" }}>{error}</p>}

      {checkin && (
        <>
          <p className="coach-response">{checkin}</p>

          {proposedAction && (
            <div style={{ marginTop: 4, padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{describeAction(proposedAction)}</strong>
                {actionPreview && (
                  <span
                    className={`assessment-badge ${
                      actionPreview.overall === "recommended" ? "green" : actionPreview.overall === "caution" ? "yellow" : "red"
                    }`}
                  >
                    {actionPreview.overall.replace("_", " ")}
                  </span>
                )}
              </div>
              {actionPreview && (
                <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                  {actionPreview.weeks.map((w) => (
                    <div key={w.weekNumber}>
                      Week {w.weekNumber} TSS: {w.tssBefore} → {w.tssAfter} ({w.delta >= 0 ? "+" : ""}
                      {w.delta})
                    </div>
                  ))}
                </div>
              )}
              {actionPreview && (
                <div style={{ fontSize: 13, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>{actionPreview.recovery.message}</div>
                  <div>{actionPreview.proximity.message}</div>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={applyAction} disabled={applying}>
                  {applying ? "Applying..." : "Apply this suggestion"}
                </button>
              </div>
              {applyStatus && <p className="form-status">{applyStatus}</p>}
            </div>
          )}

          {generatedAt && (
            <p className="form-status">
              Generated {new Date(generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </>
      )}

      {!checkin && !loading && !error && (
        <p className="empty-today">
          Pulls your recent compliance history, recovery trend, and upcoming plan for a real written check-in — and
          can propose a specific, previewed change when one's warranted.
        </p>
      )}
    </div>
  );
}
