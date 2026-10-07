-- Kill-only bookings.
--
-- Charlie, 2026-10-01 (on /schedule): "Need a kill only indicator. Something
-- we dont intend on processing."
--
-- The column was already on production when this shipped (boolean, default
-- false, no row set) with nothing reading or writing it. This file is the
-- record of what the app now expects; the statement is a no-op there.
--
-- APPLIED (pre-existing) — safe to re-run.

alter table harvest_appointments
  add column if not exists kill_only boolean not null default false;
