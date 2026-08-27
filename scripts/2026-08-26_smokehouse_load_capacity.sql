-- Pieces per smokehouse load.
--
-- The house was only ever described in POUNDS (cook_profile.lbs_per_batch), and
-- that column is still null on every profile because the controller logs never
-- recorded a load size. But the floor doesn't count hams in pounds — it counts
-- hams. Charlie counted the racks on 2026-08-25: 24 hams per load, 72 bacons
-- per load (feedback 2026-08-26).
--
-- So capacity gets a second, countable basis. A profile may carry either, both,
-- or neither: batchesFor() takes whichever demands more loads, and a profile
-- with neither is still one load, exactly as before.
alter table cook_profile
  add column if not exists units_per_batch integer,
  add column if not exists unit_label      text;

comment on column cook_profile.units_per_batch is
  'How many pieces fit in one house load. Counted on the floor, not fitted from the logs.';
comment on column cook_profile.unit_label is
  'What one unit is called, plural, for display: hams, bacons, sticks.';

-- Counted by Charlie, 2026-08-25.
update cook_profile set units_per_batch = 24, unit_label = 'hams'
  where profile_key = 'BONE IN HAM';
update cook_profile set units_per_batch = 72, unit_label = 'bacons'
  where profile_key = 'SMKD BACON';

-- 2026-08-27: the bacon side is counted in COMBS, not bellies. A belly takes a
-- whole comb but shoulder bacon hangs two to a comb (Charlie), so the capacity
-- unit is the comb and lib/cureLoad.ts charges each product its slot cost.
update cook_profile set unit_label = 'combs' where profile_key = 'SMKD BACON';
