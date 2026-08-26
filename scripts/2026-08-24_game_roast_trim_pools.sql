-- Wild game arrives as TWO different materials, and they do not substitute.
--
-- Roasts are whole muscle. Steaks and jerky are sliced off them and can be made
-- from nothing else - you cannot slice jerky out of a bag of trim. Trim is
-- everything that goes through the grinder: sticks, summer sausage, salami,
-- brotwurst, bulk sausage and burger.
--
-- Charlie, 2026-08-24: "We take all the roasts they bring and make whatever we
-- can from the roasts, whether they want steaks or jerky as their top priority.
-- Then we figure out what they wanted to do with their trim."
--
-- Treating it as one pool let a jerky order read as "filled" against a cooler
-- with no roasts in it. So the weights are recorded separately and the order is
-- ranked twice: once against the roasts, once against the trim.

ALTER TABLE game_intakes
  -- Weighed apart at the counter. Either may be null - an order can still be
  -- ranked without them, it just cannot say where the meat runs out.
  ADD COLUMN IF NOT EXISTS roast_lbs numeric,
  ADD COLUMN IF NOT EXISTS trim_lbs  numeric;

COMMENT ON COLUMN game_intakes.roast_lbs IS
  'Whole-muscle roasts weighed in. The only thing steaks and jerky can be made from.';
COMMENT ON COLUMN game_intakes.trim_lbs IS
  'Trim weighed in. Everything that goes through the grinder comes off this.';
COMMENT ON COLUMN game_intakes.weight_in_lbs IS
  'Total base material. Normally roast_lbs + trim_lbs; kept as its own column because plenty of drop-offs get one weight and nothing more.';

-- Which pool a service eats from.
--   'roast'  - consumes whole muscle (steaks, jerky, roasts kept whole)
--   'trim'   - consumes grind (sticks, summer, brotwurst, sausage, burger)
--   'either' - a treatment or fee that consumes neither (curing, cleaning,
--              the fat and trim we ADD, buffalo)
ALTER TABLE game_rates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'either';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_rates_source_check') THEN
    ALTER TABLE game_rates ADD CONSTRAINT game_rates_source_check
      CHECK (source IN ('roast','trim','either'));
  END IF;
END $$;

UPDATE game_rates SET source = 'roast' WHERE key IN ('jerky','slicing','packaging');
UPDATE game_rates SET source = 'trim'  WHERE key IN ('sticks','summer','brotwurst','sausage','grinding');
UPDATE game_rates SET source = 'either' WHERE key IN
  ('curing','cleaning','add_beef_fat','add_pork_fat','add_beef_trim','add_pork_trim',
   'buffalo_receive','buffalo_processing');

-- Packaging and slicing become order-able lines in their own right - "roasts
-- kept whole" and "steak the roasts" are things a hunter picks, not services
-- that appear from nowhere at packout.
UPDATE game_rates SET label = 'Roasts kept whole'     WHERE key = 'packaging';
UPDATE game_rates SET label = 'Steaks off the roasts' WHERE key = 'slicing';
UPDATE game_rates SET label = 'Ground / burger'       WHERE key = 'grinding';
