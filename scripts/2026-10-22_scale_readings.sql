-- Live weight off a floor scale (Charlie, 2026-10-22).
--
-- This table already existed in Supabase (made 2026-09-05 for a laptop test
-- of a kiosk agent that never shipped; its one row said "scale not
-- connected"). Recorded here so the repo carries its shape. One row per
-- scale, overwritten on every report, never appended: the point is "what is
-- on the platform now", not a log.
--
-- Written by /api/scale-readings/device (service role) from the Pico on the
-- Rice Lake indicator (scripts/pico-scale). Read by /api/scale-readings for
-- the harvest page. The anon SELECT policy predates this and stays.

create table if not exists public.scale_readings (
  scale_id    text primary key,          -- 'live_animal'
  kiosk       text,                      -- which board reported
  kg          numeric,
  lb          numeric,
  stable      boolean not null default false,   -- indicator says no motion
  stale       boolean not null default false,   -- the board lost the indicator
  below_zero  boolean not null default false,
  read_at     timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  raw         jsonb                      -- the frame as received, or the error
);
alter table public.scale_readings enable row level security;
comment on table public.scale_readings is 'Live scale readings pushed by the Pico on each floor scale (scripts/pico-scale); app reads, service role writes.';
