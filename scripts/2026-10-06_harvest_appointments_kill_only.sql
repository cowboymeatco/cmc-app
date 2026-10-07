-- ─────────────────────────────────────────────────────────────────────────────
-- Kill-only bookings — animals we harvest but never intend to cut here.
--
-- Charlie, 2026-10-01 (on /schedule): "Need a kill only indicator. Something
-- we dont intend on processing." A booking had no service-type field, only
-- notes, so a hanging beef going out the door whole looked exactly like one
-- waiting on a cut sheet — on the harvest calendar and on the cut schedule.
--
-- One flag on the booking. The cut schedule stops counting these as "waiting
-- on sheet", the harvest schedule stops nagging for instructions, and the
-- carcass still leaves the rail the way a delivered-whole one always has (the
-- 🚚 button → harvest_log.status = 'delivered'), which billing already reads
-- as no cut & wrap.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.harvest_appointments
  add column if not exists kill_only boolean not null default false;

comment on column public.harvest_appointments.kill_only is
  'True when the animal is harvested here but not cut & wrapped here — leaves the rail whole. See scripts/2026-10-06_harvest_appointments_kill_only.sql.';
