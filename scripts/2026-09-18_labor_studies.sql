-- Timing studies for /exec/study: time each hands-on step of a product once
-- in a while, turn it into a standard (crew-minutes per finished lb) and a
-- share of the price. Service role only (read/written by /api/exec/study).
create table if not exists public.labor_studies (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  product     text not null,
  cut_date    date not null,
  customers   text[] not null default '{}',
  tag_count   integer not null default 0,
  green_lbs   numeric(8,1),
  notes       text,
  status      text not null default 'open' check (status in ('open','closed')),
  closed_at   timestamptz
);
create table if not exists public.labor_study_segments (
  id          uuid primary key default gen_random_uuid(),
  study_id    uuid not null references public.labor_studies(id) on delete cascade,
  step        text not null,
  crew        integer not null default 1 check (crew between 1 and 20),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists labor_study_segments_study on public.labor_study_segments(study_id);
alter table public.labor_studies enable row level security;
alter table public.labor_study_segments enable row level security;
revoke all on public.labor_studies, public.labor_study_segments from anon, authenticated;
