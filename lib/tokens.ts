import { pool } from "./db";

export type Provider = "strava" | "whoop";

export interface StoredToken {
  provider: Provider;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  athlete_id: string | null;
}

export async function saveToken(t: {
  provider: Provider;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  athleteId?: string;
}) {
  await pool.query(
    `insert into oauth_tokens (provider, access_token, refresh_token, expires_at, athlete_id, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (provider) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       athlete_id = coalesce(excluded.athlete_id, oauth_tokens.athlete_id),
       updated_at = now()`,
    [t.provider, t.accessToken, t.refreshToken, t.expiresAt, t.athleteId ?? null]
  );
}

export async function getToken(provider: Provider): Promise<StoredToken | null> {
  const { rows } = await pool.query(
    `select provider, access_token, refresh_token, expires_at, athlete_id
     from oauth_tokens where provider = $1`,
    [provider]
  );
  return rows[0] ?? null;
}
