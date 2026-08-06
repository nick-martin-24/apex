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

create table if not exists activity_streams (
  activity_id text primary key references activities(id) on delete cascade,
  time_s int[],           -- seconds elapsed at each sample point
  watts int[],            -- power at each sample (nulls where no power meter data)
  heartrate int[],        -- heart rate at each sample
  velocity_ms numeric[],  -- speed at each sample
  altitude_m numeric[],
  distance_m numeric[],
  created_at timestamptz not null default now()
);

create table if not exists athlete_settings (
  id boolean primary key default true check (id),  -- single-row table, personal use
  ftp_watts int,
  updated_at timestamptz not null default now()
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

create table if not exists plans (
  id serial primary key,
  type text not null,                  -- 'ftp_builder' for now; other templates later
  start_date date not null,
  duration_weeks int,
  key_workouts_per_week int,
  target_weekly_hours numeric,
  rides_per_week int,
  allowed_types jsonb,
  status text not null default 'active', -- 'active' | 'completed' | 'abandoned'
  created_at timestamptz not null default now()
);

create table if not exists planned_workouts (
  id serial primary key,
  plan_id int not null references plans(id) on delete cascade,
  week_number int not null,
  phase text not null,                 -- 'base' | 'build' | 'peak' | 'taper'
  day_offset int not null,             -- 0-6, days since that week's Monday
  scheduled_date date not null,
  title text not null,
  description text,
  target_duration_min int,
  target_tss int,
  structure jsonb,                     -- interval breakdown, e.g. [{type:"warmup",min:15},{type:"interval",reps:4,on_min:8,on_pct_ftp:95,off_min:4,off_pct_ftp:50}]
  completed_activity_id text references activities(id),
  created_at timestamptz not null default now()
);
