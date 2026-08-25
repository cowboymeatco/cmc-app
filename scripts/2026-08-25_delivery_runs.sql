-- APPLIED 2026-08-25. Do not re-run — kept as the record of the schema.
--
-- A delivery run the plant PLANS, as opposed to delivery_scans, which records a
-- run that already happened. Charlie (2026-08-25): "Can I make a delivery
-- schedule so that it would show up on /calendar." Its own table because a
-- planned run has no boxes on it yet — the stops are names and towns, and the
-- barcodes only exist once the truck is being loaded.
create table if not exists delivery_runs (
  id          uuid primary key default gen_random_uuid(),
  run_date    date        not null,
  route       text        not null default '',   -- where the truck is going: "Billings", "Baker", "Miles City"
  driver      text        not null default '',
  depart_time text,                              -- HH:MM, local; blank when it doesn't matter
  -- Who's on the run. Free-form names rather than links: a stop is often a
  -- customer we haven't packed for yet, and a run gets planned before the
  -- sessions exist.
  stops       jsonb       not null default '[]'::jsonb,
  notes       text        not null default '',
  status      text        not null default 'planned',  -- planned | out | delivered | cancelled
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists delivery_runs_date_idx on delivery_runs (run_date);

alter table delivery_runs enable row level security;

-- Same posture as the other staff-only operational tables: the app's anon key
-- reads and writes it, and the plant is the only place the app is reachable.
drop policy if exists delivery_runs_all on delivery_runs;
create policy delivery_runs_all on delivery_runs for all to anon, authenticated using (true) with check (true);
