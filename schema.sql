-- Run this once against your Postgres database (Supabase/Neon SQL editor works fine)

create table if not exists oauth_tokens (
  provider text primary key,           -- 'strava' or 'whoop'
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  athlete_id text,                     -- provider's user id, for reference
  updated_at timestamptz not null default now()
);

create table if not exists activities (
  id text primary key,                 -- Strava activity id
  provider text not null default 'strava',
  name text,
  type text,
  start_date timestamptz,
  moving_time_s int,
  distance_m numeric,
  elevation_gain_m numeric,
  avg_watts numeric,
  weighted_avg_watts numeric,          -- normalized power, if present
  avg_heartrate numeric,
  max_heartrate numeric,
  avg_speed_ms numeric,
  raw jsonb,                           -- full payload for anything not modeled above
  created_at timestamptz not null default now()
);

create table if not exists recovery_days (
  date date primary key,               -- one row per calendar day
  recovery_score numeric,              -- WHOOP recovery %
  strain numeric,                      -- WHOOP day strain
  resting_hr numeric,
  hrv_ms numeric,
  sleep_performance numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);
