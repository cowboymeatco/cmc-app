-- Smokehouse loads: several customers' value-add jobs cooked as ONE house load.
--
-- Charlie, 2026-10-26: "can I combine like 5 snackstick custom customers into
-- one load?" Until now a value_add_jobs row was one customer's product, one
-- WIP tag, one slot on the schedule board — so five customers' snack sticks
-- planned as five back-to-back cooks and tapped in and out five times.
--
-- A load is the set of jobs sharing a load_id. Jobs stay one per customer per
-- flavor (their own WIP tag, weight in, cut-card link, weight out); the load
-- adds three things: one cook on the schedule, one in/out tap for the group,
-- and one batch code. The batch code is the kill-sheet julian plus the cook's
-- number that day — 26299-2 is the second cook of 2026-10-26 — and Chris can
-- edit it before anything goes in.
--
-- The in/out taps STAY on value_add_jobs.smoke_in_at / smoke_out_at and are
-- copied across the load by the API, so lib/cookMatch.ts, /cooks and the
-- pipeline keep reading the columns they always did.
--
-- seal_number: a numbered tamper seal — the same stock the cure cooler uses —
-- zip-tied to the job's product on the way into the house. Hams and bacon
-- already ride through the heat wearing theirs; a direct-thermal label would
-- not. One seal, one job; the partial unique index also keeps a seal from
-- landing on two jobs, and the API refuses one that is live on a cure tag.
--
-- Same posture as value_add_jobs and cure_tags today: no RLS, service role
-- only through the API routes.

create table if not exists value_add_loads (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  batch_code text not null unique,
  notes      text
);

comment on table  value_add_loads            is 'One smokehouse cook. Jobs in it share value_add_jobs.load_id.';
comment on column value_add_loads.batch_code is 'Julian YYDDD of the cook day, a dash, the cook number that day: 26299-2.';

alter table value_add_jobs
  add column if not exists load_id     uuid references value_add_loads(id) on delete set null,
  add column if not exists seal_number text;

comment on column value_add_jobs.load_id     is 'The house load this job cooks in; null until grouped or tapped in.';
comment on column value_add_jobs.seal_number is 'Numbered tamper seal on this job''s product in the house, 7 digits with the leading zero, as scanned.';

create index        if not exists value_add_jobs_load_id_idx     on value_add_jobs (load_id);
create unique index if not exists value_add_jobs_seal_number_key on value_add_jobs (seal_number) where seal_number is not null;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop index if exists value_add_jobs_seal_number_key;
-- drop index if exists value_add_jobs_load_id_idx;
-- alter table value_add_jobs drop column if exists seal_number, drop column if exists load_id;
-- drop table if exists value_add_loads;
