-- Hunter-submitted game orders, taken online before the meat arrives.
--
-- Same shape as the relationship between cutting_instructions and a booked
-- appointment: the public form writes a REQUEST here, and the counter turns it
-- into a real game_intakes row when the cooler actually lands. Two reasons it
-- is not written straight into game_intakes:
--   * a claim number would be burned on every hunter who fills the form and
--     never shows up, and the numbers are handed out on paper tags;
--   * an intake asserts "this meat is in our building", which is not true until
--     somebody weighs it.
CREATE TABLE IF NOT EXISTS game_orders (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),

  hunter_name    text        NOT NULL,
  hunter_phone   text        NOT NULL DEFAULT '',
  hunter_email   text        NOT NULL DEFAULT '',

  species        text        NOT NULL DEFAULT '',
  license_tag_no text        NOT NULL DEFAULT '',
  hunting_district text      NOT NULL DEFAULT '',
  harvest_date   date,

  -- What they are bringing, in their words, and roughly how much. Estimated,
  -- because it is weighed on our scale at the counter - this is for planning
  -- the smokehouse, not for billing.
  base_material    text      NOT NULL DEFAULT '',
  est_weight_lbs   numeric,
  finished_product text      NOT NULL DEFAULT ''
                             CHECK (finished_product IN ('', 'Fresh', 'Frozen')),
  -- Roughly when they plan to drop it off, so the board can see it coming.
  expected_date    date,

  -- The order itself - the same GameSheet shape the counter screen produces,
  -- so importing it is a copy rather than a translation.
  cut_sheet      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes          text        NOT NULL DEFAULT '',

  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','imported','archived')),
  linked_intake_id uuid      REFERENCES game_intakes(id) ON DELETE SET NULL,
  imported_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_game_orders_status  ON game_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_orders_hunter  ON game_orders(lower(hunter_name));

-- RLS: the public may WRITE here, never READ.
-- This table holds hunters' names, phone numbers and licence tag numbers. The
-- form needs to submit; nothing on the public internet needs to read anyone
-- else's submission back. cmc-app reads it server-side with the service role
-- (see /api/game/orders), so staff are unaffected.
ALTER TABLE game_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_orders_public_insert ON game_orders;
CREATE POLICY game_orders_public_insert ON game_orders
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Deliberately no SELECT/UPDATE/DELETE policy for anon: with RLS on, that is a
-- default deny. Do not "fix" this by adding a permissive USING (true).
