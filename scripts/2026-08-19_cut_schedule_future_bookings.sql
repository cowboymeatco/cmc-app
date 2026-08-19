-- APPLIED 2026-08-19 (Supabase migration cut_schedule_future_bookings).
-- Mirrored here for the record — do not re-run against production.
--
-- Lets the cut schedule hold a placeholder for an animal that hasn't been
-- harvested yet, so a big booking can be split across cutting days before it
-- arrives (Charlie: "I don't think I can do Laurie in one day").
--
-- These do NOT reuse appointment_id: on a 'carcass' row that column holds a
-- harvest_log.id, while a future placeholder points at a harvest_appointments.id.
-- Two different id spaces in one column would be a trap, so futures get their
-- own column plus a per-animal sequence (1..head_count).

alter table cut_schedule_items
  drop constraint if exists cut_schedule_items_kind_check;

alter table cut_schedule_items
  add constraint cut_schedule_items_kind_check
  check (kind = any (array['carcass'::text, 'break'::text, 'future'::text]));

alter table cut_schedule_items
  add column if not exists future_appointment_id text,
  add column if not exists future_seq integer;

-- A future row is only meaningful with both parts; a carcass/break row must
-- carry neither.
alter table cut_schedule_items
  drop constraint if exists cut_schedule_items_future_shape;

alter table cut_schedule_items
  add constraint cut_schedule_items_future_shape check (
    (kind = 'future' and future_appointment_id is not null and future_seq is not null)
    or
    (kind <> 'future' and future_appointment_id is null and future_seq is null)
  );
