"use client";

import { useState } from "react";

export default function CoachCheckin() {
  const [checkin, setCheckin] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getCheckin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/checkin");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate check-in");
      } else {
        setCheckin(data.checkin);
        setGeneratedAt(data.generatedAt);
      }
    } catch {
      setError("Failed to reach the coach endpoint.");
    } finally {
      setLoading(false);
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
          {generatedAt && (
            <p className="form-status">
              Generated {new Date(generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </>
      )}

      {!checkin && !loading && !error && (
        <p className="empty-today">
          Pulls your recent compliance history, recovery trend, and upcoming plan for a real written check-in.
        </p>
      )}
    </div>
  );
}
