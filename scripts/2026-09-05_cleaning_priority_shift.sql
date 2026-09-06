-- Cleaning shift priority view + lifecycle (spec: CMC_Cleaning_Priority_Spec.md, 2026-09-05)
-- APPLIED to prod 2026-09-05 (migration cleaning_priority_shift_lifecycle). Do not re-run.
--
-- cleaning_tasks.priority / cleaning_shift_items.priority and the
-- (shift_id, priority, sort_order) index were applied ahead of this and are
-- NOT repeated here.

-- 1. Items can roll to the morning. A P2/P3 item still open at close-out is
--    marked 'rolled' and shows up on /cleaning/morning for the first cutter.
alter table cleaning_shift_items drop constraint if exists cleaning_shift_items_status_check;
alter table cleaning_shift_items add constraint cleaning_shift_items_status_check
  check (status in ('pending','done','na','issue','rolled'));

-- 2. Shift lifecycle.
--    p1_complete_at   — stamped by the app the moment the last P1 item is done/na.
--                       A column, not a note, so the 14-day review can read it.
--    crew_ids         — who checked in at "Start shift".
--    area_assignments — { "<area name>": "<cleaning_crew.id>" }, the A/B split,
--                       editable per shift. Keyed by area NAME because shift
--                       items snapshot area_name rather than an id.
--    preop_time       — FSIS pre-op the next morning; rolled items still open
--                       past it get flagged on the morning view.
alter table cleaning_shifts
  add column if not exists p1_complete_at   timestamptz,
  add column if not exists crew_ids         uuid[]  not null default '{}',
  add column if not exists area_assignments jsonb   not null default '{}',
  add column if not exists preop_time       time    not null default '06:00';

-- 3. Every shift on file was auto-created by a page load (6am, 10am, 3pm…)
--    and none was ever closed. Close them all as 'system' with no closed_at,
--    so hours read "—" rather than a made-up number. Nothing is rolled from
--    them: they predate the priority build.
update cleaning_shifts
   set status    = 'closed',
       closed_by = 'system',
       notes     = coalesce(notes || E'\n', '') ||
                   'Closed in bulk 2026-09-05 when the priority view shipped; never closed by the crew.'
 where status = 'open';
