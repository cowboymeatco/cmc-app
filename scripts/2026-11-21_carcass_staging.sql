-- Carcass QR tags and the staging cooler (Charlie, 2026-11-21).
-- Applied to production 2026-11-21 on Charlie's yes ("Run it").
--
-- Staging is not a status: a staged carcass stays 'chilling' (capacity, the
-- cut schedule and the cooler charts count that as hanging) and staged_at
-- marks the move to the staging cooler. cut_at is stamped whenever a carcass
-- goes to 'cut'. aging_target_days null = species default (beef 10 days).
alter table public.harvest_log
  add column staged_at timestamptz,
  add column staged_by text,
  add column cut_at timestamptz,
  add column cut_by text,
  add column aging_target_days integer;
