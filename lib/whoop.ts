import { getToken, saveToken } from "./tokens";

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";

export function buildWhoopAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: process.env.WHOOP_REDIRECT_URI!,
    response_type: "code",
    state,
  });
  // Build manually: URLSearchParams encodes spaces as "+", which some OAuth
  // servers don't decode back to a space in the query string (only in
  // form-urlencoded bodies). Use %20 explicitly to be safe.
  const scope = encodeURIComponent(
    "offline read:recovery read:cycles read:sleep read:workout"
  ).replace(/\+/g, "%20");
  return `${AUTH_URL}?${params.toString()}&scope=${scope}`;
}

export async function exchangeWhoopCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
      redirect_uri: process.env.WHOOP_REDIRECT_URI!,
    }),
  });
  if (!res.ok) throw new Error(`WHOOP token exchange failed: ${await res.text()}`);
  const data = await res.json();

  await saveToken({
    provider: "whoop",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });

  return data;
}

async function refreshWhoopToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`WHOOP token refresh failed: ${await res.text()}`);
  const data = await res.json();

  await saveToken({
    provider: "whoop",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });

  return data.access_token as string;
}

export async function getValidWhoopAccessToken(): Promise<string> {
  const token = await getToken("whoop");
  if (!token) throw new Error("No WHOOP token stored — complete the OAuth flow first");

  const expiresInMs = token.expires_at.getTime() - Date.now();
  if (expiresInMs < 5 * 60 * 1000) {
    return refreshWhoopToken(token.refresh_token);
  }
  return token.access_token;
}

// Most recent recovery score (today's, if available)
export async function getLatestWhoopRecovery() {
  const accessToken = await getValidWhoopAccessToken();
  const res = await fetch(`${API_BASE}/recovery?limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`WHOOP recovery fetch failed: ${await res.text()}`);
  return res.json();
}

export async function getLatestWhoopCycle() {
  const accessToken = await getValidWhoopAccessToken();
  const res = await fetch(`${API_BASE}/cycle?limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`WHOOP cycle fetch failed: ${await res.text()}`);
  return res.json();
}

// Paginated recovery history. Pass nextToken from a previous call's
// next_token field to get the following page; omit for the first page.
export async function listWhoopRecovery(limit = 25, nextToken?: string) {
  const accessToken = await getValidWhoopAccessToken();
  const params = new URLSearchParams({ limit: String(limit) });
  if (nextToken) params.set("nextToken", nextToken);
  const res = await fetch(`${API_BASE}/recovery?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`WHOOP recovery list fetch failed: ${await res.text()}`);
  return res.json();
}

// Shared insert used by both the webhook handler and the backfill route
export async function upsertWhoopRecovery(r: any) {
  const { pool } = await import("./db");
  const date = (r.created_at ?? r.updated_at)?.slice(0, 10);
  if (!date) return;
  await pool.query(
    `insert into recovery_days (date, recovery_score, hrv_ms, resting_hr, raw)
     values ($1,$2,$3,$4,$5)
     on conflict (date) do update set
       recovery_score = excluded.recovery_score,
       hrv_ms = excluded.hrv_ms,
       resting_hr = excluded.resting_hr,
       raw = excluded.raw`,
    [
      date,
      r.score?.recovery_score ?? null,
      r.score?.hrv_rmssd_milli ?? null,
      r.score?.resting_heart_rate ?? null,
      JSON.stringify(r),
    ]
  );
}
