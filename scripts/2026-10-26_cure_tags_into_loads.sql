-- Hams and bacons scanned into a smokehouse load, piece by piece.
--
-- Charlie, 2026-10-26: "Can we get a mechanism to scan hams and bacons in per
-- load also?" Every ham and belly already wears a numbered seal (cure_tags),
-- so the house door scans the same seal the cure cooler did. Chris picks the
-- load's batch code first, then scans pieces into it; the app keeps one
-- value-add job per customer per product in the load (so yield, weight out
-- and the Enviropak cook match work exactly as they do for snack sticks), and
-- counts pieces onto it.
--
-- cure_tags.load_id            — the load this piece went into the house on.
-- cure_tags.smokehouse_in_at   — stamped when the load is tapped in; the cure
--                                cooler board stops counting the piece as
--                                sitting in cure from then on.
-- cure_tags.smokehouse_out_at  — stamped when the load is tapped out.
-- value_add_jobs.piece_count   — how many pieces a cure-fed job stands for.
--                                The house is sized in pieces for hams and
--                                bacon (cook_profile.units_per_batch, counted
--                                on the floor 2026-08-25), so the planner can
--                                finally use that number.
--
-- Same posture as the rest of these tables: no RLS, service role through the
-- API routes.

alter table cure_tags
  add column if not exists load_id           uuid references value_add_loads(id) on delete set null,
  add column if not exists smokehouse_in_at  timestamptz,
  add column if not exists smokehouse_out_at timestamptz;

comment on column cure_tags.load_id           is 'Smokehouse load this piece went into the house on; null while it sits in cure.';
comment on column cure_tags.smokehouse_in_at  is 'When its load was tapped into the house.';
comment on column cure_tags.smokehouse_out_at is 'When its load was tapped out.';

create index if not exists cure_tags_load_id_idx on cure_tags (load_id);

alter table value_add_jobs
  add column if not exists piece_count integer;

comment on column value_add_jobs.piece_count is 'Pieces this job stands for (hams, combs); kept in step with the cure seals scanned into its load.';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- alter table value_add_jobs drop column if exists piece_count;
-- drop index if exists cure_tags_load_id_idx;
-- alter table cure_tags drop column if exists smokehouse_out_at, drop column if exists smokehouse_in_at, drop column if exists load_id;
