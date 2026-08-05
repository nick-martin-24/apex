"use client";

import { useState } from "react";

export default function PlanForm({ currentFtp }: { currentFtp: number | null }) {
  const [ftp, setFtp] = useState(currentFtp ? String(currentFtp) : "");
  const [ftpStatus, setFtpStatus] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(nextMonday());
  const [durationWeeks, setDurationWeeks] = useState("10");
  const [keyWorkoutsPerWeek, setKeyWorkoutsPerWeek] = useState("2");
  const [targetWeeklyHours, setTargetWeeklyHours] = useState("6");
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitFtp(e: React.FormEvent) {
    e.preventDefault();
    setFtpStatus("Saving...");
    const res = await fetch("/api/settings/ftp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ftp_watts: Number(ftp) }),
    });
    const data = await res.json();
    setFtpStatus(res.ok ? `FTP set to ${data.ftp_watts}W` : `Error: ${data.error}`);
  }

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setPlanStatus("Creating plan...");
    const res = await fetch("/api/plans/ftp-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: startDate,
        duration_weeks: Number(durationWeeks),
        key_workouts_per_week: Number(keyWorkoutsPerWeek),
        target_weekly_hours: Number(targetWeeklyHours),
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setPlanStatus(`Plan created (${data.weeks} weeks). Reloading...`);
      setTimeout(() => window.location.reload(), 800);
    } else {
      setPlanStatus(`Error: ${data.error}`);
    }
  }

  // Default the date picker to the upcoming Monday, since the plan engine
  // assumes weeks start on Monday for day-offset math.
  function nextMonday(): string {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = day === 1 ? 0 : ((8 - day) % 7) || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  return (
    <div className="form-row">
      <form onSubmit={submitFtp} className="field-group">
        <h4>FTP</h4>
        <label>
          Watts
          <input
            type="number"
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            required
            min={50}
            style={{ width: 70 }}
          />
        </label>
        <div>
          <button type="submit">Save</button>
        </div>
        {ftpStatus && <p className="form-status">{ftpStatus}</p>}
      </form>

      <form onSubmit={submitPlan} className="field-group">
        <h4>New FTP builder plan</h4>
        <label>
          Start (Mon)
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          Duration
          <input
            type="number"
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(e.target.value)}
            min={4}
            max={20}
            required
            style={{ width: 50 }}
          />
          weeks
        </label>
        <label>
          Key workouts/wk
          <select value={keyWorkoutsPerWeek} onChange={(e) => setKeyWorkoutsPerWeek(e.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>
        <label>
          Hours/wk target
          <input
            type="number"
            value={targetWeeklyHours}
            onChange={(e) => setTargetWeeklyHours(e.target.value)}
            min={2}
            max={20}
            step={0.5}
            required
            style={{ width: 50 }}
          />
        </label>
        <div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create plan"}
          </button>
        </div>
        {planStatus && <p className="form-status">{planStatus}</p>}
      </form>
    </div>
  );
}
