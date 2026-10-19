-- 2026-10-18 — Cut schedule week view: a full cutting day in pounds.
--
-- Charlie, asked what a full day should mean to the week view: pounds per
-- day, with unweighed animals priced at our own average carcass sizes. The
-- figure lives with the other throughput settings. Null = the planner derives
-- it from beef_eq_per_day × the trailing average beef carcass.
--
-- Applied to production via the Supabase migration
-- "capacity_settings_lbs_per_day" on 2026-10-18 (MT evening).

alter table public.capacity_settings add column if not exists lbs_per_day numeric;
