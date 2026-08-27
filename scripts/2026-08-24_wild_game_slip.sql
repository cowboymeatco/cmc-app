-- Wild game, part two: make the module match the paper slip, and make the
-- prices something Jill can change without a deploy.
--
-- ── What the slip taught us ─────────────────────────────────────────────
-- The printed "Wild Game Processing" slip (Charlie, 2026-08-24) is the real
-- offering, and it disagrees with the first cut of this module in ways that
-- would have put wrong numbers on hunters' tickets:
--
--   1. CLEANING FEE IS HOURLY — "$60/hr" with a blank for the hours, not a
--      flat $60 an animal. A filthy hide-on elk that takes three hours is
--      $180, and we were billing $60.
--   2. GHOST PEPPER IS A CHEESE. The slip lists four cheeses — Cheddar (CH),
--      Pepperjack (PJ), Mozzarella (MZ), Ghost Pepper (GP). Deriving "has
--      cheese" from the product name missed GP entirely, billing a cheese
--      product at $4.50 instead of $5.25.
--   3. CURING IS $2.50/# on the slip; QuickBooks item 97 said $2.00. Settled
--      2026-08-26 — Charlie chose the slip, and item 97 was raised to $2.50 in
--      QuickBooks so the books agree. All 19 wild game rates now match QBO.
--
-- ── The structural lesson ──────────────────────────────────────────────
-- On the slip, cheese is its OWN column: you pick a flavour, then tick w/
-- Cheese and name which cheese. The PLU list encodes both into one string
-- ("WILD GAME JALAPENO CHEDDAR SNACK STICKS"). The slip is how the order is
-- actually taken, so flavour and cheese become two fields, and the PLU is
-- what we reach for at labelling time — which is also why the two lists do
-- not match each other and why game_flavors.plu_number is nullable.

-- ── Prices ──────────────────────────────────────────────────────────────
-- One row per billable service. This exists so that "Jill is updating pricing
-- today" is a data change, not a deploy. Rates are still STAMPED onto
-- game_outputs at weigh-out, so editing a price here never rewrites a ticket
-- that was already quoted.
CREATE TABLE IF NOT EXISTS game_rates (
  key           text        PRIMARY KEY,
  label         text        NOT NULL,
  -- 'lb' = per finished pound, 'hr' = per hour, 'ea' = flat per animal
  unit          text        NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb','hr','ea')),
  rate          numeric     NOT NULL,
  -- The w/ Cheese price, where the slip has a second column. NULL means this
  -- service has no cheese variant at all (jerky, grinding, packaging).
  cheese_rate   numeric,
  -- What it books against in QuickBooks. Nullable: the slip carries services
  -- QBO has no item for, and we would rather show the gap than invent an id.
  qbo_item_id   text,
  qbo_item_name text,
  -- Grouping on the pricing screen: 'product' totals into Total Product,
  -- 'other' into Total Other — the two subtotals the slip already has.
  bucket        text        NOT NULL DEFAULT 'product' CHECK (bucket IN ('product','other')),
  sort          integer     NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true,
  note          text        NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text        NOT NULL DEFAULT ''
);

-- ── Flavours ────────────────────────────────────────────────────────────
-- The lists off the slip. Editable, because a flavour gets added or dropped
-- most seasons and that should not be a code change either.
--
-- plu_number is nullable and frequently null. The slip and the scale genuinely
-- disagree in both directions — the slip offers Smoked German brotwurst and
-- Wild Fire jerky that have no wild game PLU (so we can sell it but cannot
-- label it), and the scale carries stick flavours the slip never offers. That
-- gap is real and is surfaced rather than papered over.
CREATE TABLE IF NOT EXISTS game_flavors (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  category    text        NOT NULL REFERENCES game_rates(key) ON UPDATE CASCADE,
  name        text        NOT NULL,
  plu_number  text,
  sort        integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  UNIQUE (category, name)
);

CREATE INDEX IF NOT EXISTS idx_game_flavors_cat ON game_flavors(category, sort);

-- ── Slip fields the intake form was missing ─────────────────────────────
ALTER TABLE game_intakes
  -- "Base Material" on the slip: what the products get made from, in the
  -- crew's words — "elk trim", "2 deer, boned out".
  ADD COLUMN IF NOT EXISTS base_material    text NOT NULL DEFAULT '',
  -- Fresh or Frozen. Drives whether it can wait for a smokehouse slot.
  ADD COLUMN IF NOT EXISTS finished_product text NOT NULL DEFAULT ''
      CHECK (finished_product IN ('', 'Fresh', 'Frozen')),
  -- Hours against the $60/hr cleaning fee. NULL/0 means no cleaning charge —
  -- this replaces the old boolean, which could only ever bill one hour.
  ADD COLUMN IF NOT EXISTS cleaning_hours   numeric,
  -- "Load Out Information" — how many boxes went home, and from where.
  ADD COLUMN IF NOT EXISTS boxes_out        integer;

-- Carry the old boolean across: a ticked cleaning_fee was worth one hour.
UPDATE game_intakes SET cleaning_hours = 1
 WHERE cleaning_fee IS TRUE AND cleaning_hours IS NULL;

-- ── Slip fields the weigh-out was missing ───────────────────────────────
ALTER TABLE game_outputs
  -- Cheese as its own axis, the way the slip asks it.
  ADD COLUMN IF NOT EXISTS cheese      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cheese_type text    NOT NULL DEFAULT ''
      CHECK (cheese_type IN ('', 'CH', 'PJ', 'MZ', 'GP')),
  ADD COLUMN IF NOT EXISTS flavor      text    NOT NULL DEFAULT '',
  -- The "# Fat Trim" column that sits on EVERY flavour row of the slip. Fat
  -- goes in per batch, not once per animal, so it belongs on the line.
  ADD COLUMN IF NOT EXISTS fat_trim_lbs  numeric,
  ADD COLUMN IF NOT EXISTS fat_trim_kind text NOT NULL DEFAULT ''
      CHECK (fat_trim_kind IN ('', 'add_beef_fat', 'add_pork_fat', 'add_beef_trim', 'add_pork_trim'));

-- ── Seed: every price on the slip ───────────────────────────────────────
-- ON CONFLICT DO NOTHING so re-running never stomps an edit Jill has made.
INSERT INTO game_rates (key, label, unit, rate, cheese_rate, qbo_item_id, qbo_item_name, bucket, sort, note) VALUES
  ('brotwurst', 'Brotwurst',              'lb',  4.50, 5.25, '86',  'WILD GAME BROTWURST',          'product', 10,
   'Slip prints this as "Brats". House rule is BROTWURST — the FSIS term for our product — so the app says Brotwurst.'),
  ('summer',    'Summer Sausage / Salami','lb',  4.50, 5.25, '92',  'WILD GAME SALAMI/SUMMERS',     'product', 20, ''),
  ('sticks',    'Snack Sticks',           'lb',  4.50, 5.25, '94',  'WILD GAME STICKS',             'product', 30, ''),
  ('sausage',   'Bulk Sausage',           'lb',  3.50, NULL, '87',  'WILD GAME BULK SAUSAGE',       'product', 40, ''),
  ('jerky',     'Jerky',                  'lb', 11.00, NULL, '99',  'WILD GAME JERKY',              'product', 50, ''),
  ('packaging', 'Packaging',              'lb',  1.50, NULL, '100', 'WILD GAME PACKAGING',          'other',   60, ''),
  ('grinding',  'Grind',                  'lb',  1.75, NULL, '98',  'WILD GAME GRINDING',           'other',   70,
   'Slip offers 1#, 1.5# and 2# packages at one rate.'),
  ('slicing',   'Slicing',                'lb',  2.00, NULL, '101', 'WILD GAME SLICING',            'other',   80, ''),
  ('curing',    'Curing',                 'lb',  2.50, NULL, '97',  'WILD GAME CURING',             'other',   90,
   'Slip price. QuickBooks item 97 was $2.00 and was changed to $2.50 on 2026-08-26 so the two agree.'),
  ('add_pork_trim', 'Add Pork Trim (PT)', 'lb',  2.79, NULL, '985', 'WILD GAME ADD PORK TRIM',      'other',  100, ''),
  ('add_beef_trim', 'Add Beef Trim (BT)', 'lb',  4.99, NULL, '986', 'WILD GAME ADD BEEF TRIM',      'other',  110, ''),
  ('add_pork_fat',  'Add Pork Fat (PF)',  'lb',  1.79, NULL, '987', 'WILD GAME ADD PORK FAT',       'other',  120, ''),
  ('add_beef_fat',  'Add Beef Fat (BF)',  'lb',  2.59, NULL, '988', 'WILD GAME ADD BEEF FAT',       'other',  130, ''),
  ('cleaning',  'Cleaning Fee',           'hr', 60.00, NULL, '120', 'WILD GAME CLEANING FEE',       'other',  140,
   'PER HOUR on the slip, with a blank for how many. Not a flat fee.'),
  -- Not on the slip, but live and active in QuickBooks, and buffalo do come in.
  ('buffalo_receive',    'Buffalo Receive / Skin / Split', 'ea', 85.00, NULL, '116', 'BUFFALO RECEIVE/SKIN/SPLIT', 'other', 150,
   'From QuickBooks, not the slip — buffalo arrive as an animal, not a cooler of meat.'),
  ('buffalo_processing', 'Buffalo Processing',             'lb',  1.10, NULL, '115', 'CUSTOM BUFFALO PROCESSING',  'other', 160,
   'From QuickBooks, not the slip. Bills on the weight at the door, like livestock.')
ON CONFLICT (key) DO NOTHING;

-- ── Seed: the flavour lists, exactly as printed ─────────────────────────
INSERT INTO game_flavors (category, name, sort) VALUES
  ('brotwurst', 'Original',        10),
  ('brotwurst', 'Jalapeno',        20),
  ('brotwurst', 'Beer',            30),
  ('brotwurst', 'Supreme Pizza',   40),
  ('brotwurst', 'Dill Pickle',     50),
  ('brotwurst', 'Mango Habanero',  60),
  ('brotwurst', 'Chili Cheese',    70),
  ('brotwurst', 'Smokey Cheddar',  80),
  ('brotwurst', 'Smoked Polish',   90),
  ('brotwurst', 'Smoked German',  100),

  ('summer', 'Original',           10),
  ('summer', 'Jalapeno',           20),
  ('summer', 'Habanero',           30),
  ('summer', 'Sweet Heat',         40),
  ('summer', 'Smokey Cheddar',     50),
  ('summer', 'Helmer''s Homemade', 60),

  ('sticks', 'Original',           10),
  ('sticks', 'Jalapeno',           20),
  ('sticks', 'Pepperoni',          30),
  ('sticks', 'Sweet Heat',         40),
  ('sticks', 'Green Chile',        50),
  ('sticks', 'Teriyaki',           60),

  ('sausage', 'Bulk',              10),
  ('sausage', 'Bulk Italian',      20),
  ('sausage', 'Bulk Spicy',        30),

  ('jerky', 'Original/Peppered',   10),
  ('jerky', 'Teriyaki',            20),
  ('jerky', 'Green Chile',         30),
  ('jerky', 'Dill Pickle',         40),
  ('jerky', 'Mango Habanero',      50),
  ('jerky', 'Honey BBQ',           60),
  ('jerky', 'Wild Fire',           70),
  ('jerky', 'Sweet Heat',          80)
ON CONFLICT (category, name) DO NOTHING;

-- Link a flavour to a wild game PLU where one plainly exists, so labelling has
-- a number to reach for. Deliberately conservative: it matches only when the
-- PLU name is exactly "WILD GAME <flavour> <family>", which leaves the genuine
-- gaps (Smoked German, Wild Fire, Bulk Italian) empty instead of guessing.
UPDATE game_flavors f SET plu_number = p.plu_number
  FROM plu_items p
 WHERE p.active
   AND f.plu_number IS NULL
   AND upper(p.item_name) = upper(
         'WILD GAME ' || f.name || ' ' ||
         CASE f.category
           WHEN 'sticks'    THEN 'SNACK STICKS'
           WHEN 'brotwurst' THEN 'BROTWURST'
           WHEN 'jerky'     THEN 'JERKY'
           WHEN 'summer'    THEN 'SUMMER SAUSAGE'
           ELSE '~none~'
         END);

-- ── RLS, same posture as the rest of the module ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_rates','game_flavors']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t || '_app_access', t);
  END LOOP;
END $$;
