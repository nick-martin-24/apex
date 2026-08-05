import { getToken, saveToken } from "./tokens";

const AUTH_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";

export function buildStravaAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: process.env.STRAVA_REDIRECT_URI!,
    response_type: "code",
    approval_prompt: "auto",
    // activity:read_all needed for private activities' full data
    scope: "read,activity:read_all",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeStravaCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${await res.text()}`);
  const data = await res.json();

  await saveToken({
    provider: "strava",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
    athleteId: String(data.athlete?.id ?? ""),
  });

  return data;
}

async function refreshStravaToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${await res.text()}`);
  const data = await res.json();

  await saveToken({
    provider: "strava",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  });

  return data.access_token as string;
}

// Returns a valid access token, refreshing first if it's expired or about to be
export async function getValidStravaAccessToken(): Promise<string> {
  const token = await getToken("strava");
  if (!token) throw new Error("No Strava token stored — complete the OAuth flow first");

  const expiresInMs = token.expires_at.getTime() - Date.now();
  if (expiresInMs < 5 * 60 * 1000) {
    return refreshStravaToken(token.refresh_token);
  }
  return token.access_token;
}

// Fetches full detail (including power/HR streams) for a single activity
export async function getStravaActivity(activityId: string | number) {
  const accessToken = await getValidStravaAccessToken();
  const res = await fetch(`${API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${await res.text()}`);
  return res.json();
}

export async function getStravaActivityStreams(activityId: string | number) {
  const accessToken = await getValidStravaAccessToken();
  const keys = "watts,heartrate,velocity_smooth,altitude,distance,time";
  const res = await fetch(
    `${API_BASE}/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Strava streams fetch failed: ${await res.text()}`);
  return res.json();
}

// Persists the raw per-second (or whatever resolution Strava gives) stream
// arrays so time-in-zone and other fine-grained analysis can be computed later.
export async function upsertStravaStreams(activityId: string | number, streams: any) {
  const { pool } = await import("./db");
  await pool.query(
    `insert into activity_streams (activity_id, time_s, watts, heartrate, velocity_ms, altitude_m, distance_m)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (activity_id) do update set
       time_s = excluded.time_s, watts = excluded.watts, heartrate = excluded.heartrate,
       velocity_ms = excluded.velocity_ms, altitude_m = excluded.altitude_m, distance_m = excluded.distance_m`,
    [
      String(activityId),
      streams.time?.data ?? null,
      streams.watts?.data ?? null,
      streams.heartrate?.data ?? null,
      streams.velocity_smooth?.data ?? null,
      streams.altitude?.data ?? null,
      streams.distance?.data ?? null,
    ]
  );
}

// Lists the athlete's activities, paginated, most recent first.
// page starts at 1. Strava caps per_page at 200.
export async function listStravaActivities(page: number, perPage = 200) {
  const accessToken = await getValidStravaAccessToken();
  const res = await fetch(
    `${API_BASE}/athlete/activities?page=${page}&per_page=${perPage}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Strava activity list fetch failed: ${await res.text()}`);
  return res.json();
}

// Shared insert used by both the webhook handler and the backfill route
export async function upsertStravaActivity(detail: any) {
  const { pool } = await import("./db");
  await pool.query(
    `insert into activities
       (id, name, type, start_date, moving_time_s, distance_m, elevation_gain_m,
        avg_watts, weighted_avg_watts, avg_heartrate, max_heartrate, avg_speed_ms, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
       name = excluded.name, moving_time_s = excluded.moving_time_s,
       avg_watts = excluded.avg_watts, weighted_avg_watts = excluded.weighted_avg_watts,
       avg_heartrate = excluded.avg_heartrate, raw = excluded.raw`,
    [
      String(detail.id),
      detail.name,
      detail.type,
      detail.start_date,
      detail.moving_time,
      detail.distance,
      detail.total_elevation_gain,
      detail.average_watts ?? null,
      detail.weighted_average_watts ?? null,
      detail.average_heartrate ?? null,
      detail.max_heartrate ?? null,
      detail.average_speed ?? null,
      JSON.stringify(detail),
    ]
  );
}
