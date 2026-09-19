-- Brand inspection # on the carcass, and a marker for kill history imported
-- from the old Master Book workbook (Compliance/Animal Check In).
--
-- brand_insp_no: receiving already captures it (animal_receiving_log.brand_insp_no,
-- one number per load), but it stopped there — nothing downstream of the rail
-- could see it. The harvest page now carries it onto the carcass at Part A.
--
-- legacy_source: set on rows that were NOT recorded in this app — 'master_book'
-- for the 2023 → 2026-04-15 import. Those rows are history for charts and
-- yield/dress-% analysis only: they were never HACCP records here, so the
-- HACCP and inspector views skip them, and their free-typed owner names are
-- kept out of the producer pickers and QuickBooks linking.

alter table harvest_log add column if not exists brand_insp_no text not null default '';
alter table harvest_log add column if not exists legacy_source text;

create index if not exists harvest_log_legacy_source_idx on harvest_log (legacy_source) where legacy_source is not null;

-- Backfill live-app carcasses from their load's receiving record — only where
-- the load carries exactly ONE brand number, so no carcass gets a sibling's.
with per_appt as (
  select appointment_id, min(trim(brand_insp_no)) as brand_insp_no
  from animal_receiving_log
  where status is distinct from 'removed'
    and appointment_id is not null
    and trim(coalesce(brand_insp_no, '')) <> ''
  group by appointment_id
  having count(distinct trim(brand_insp_no)) = 1
)
update harvest_log h
   set brand_insp_no = p.brand_insp_no
  from per_appt p
 where h.appointment_id = p.appointment_id
   and h.brand_insp_no = '';
