-- Wild game — the hunter side of the plant.
--
-- ⚠ SUPERSEDED IN PLACES. This is the first migration of the module and is kept
-- as the historical record of what was created. Later scripts changed parts of
-- it; read them alongside this one:
--   2026-08-24_wild_game_slip.sql          rates + flavours off the paper slip,
--                                          hourly cleaning fee, cheese as a field
--   2026-08-24_game_additions_kind.sql     addition keys match game_rates keys
--   2026-08-24_game_rates_cheese_qbo_item.sql  cheese books to its own QBO item
--   2026-08-24_game_status_plant_flow.sql  ⚠ REPLACES the status CHECK below
--                                          with Receiving/Processing/Value Add/
--                                          Freezer/Picked Up
--   2026-08-24_game_orders_public.sql      hunter-submitted orders
--   2026-08-24_game_roast_trim_pools.sql   roast_lbs / trim_lbs, rate.source
--
-- ── Why this is not just another species on harvest_appointments ────────
-- Every other animal in this app arrives because somebody booked it. A hunter
-- arrives because they shot something on Saturday and the cooler is in the bed
-- of the truck now. There is no appointment, no producer, no kill floor, no
-- hanging weight from OUR scale on a rail we control — the animal is already
-- dead, already field dressed, and frequently already boned out into garbage
-- bags. Bolting that onto harvest_appointments would mean a booking with no
-- date, a carcass with no harvest_log, and a producer column that is really
-- the customer. So wild game gets its own intake record.
--
-- ── The other half of why ──────────────────────────────────────────────
-- Game is NOT AMENABLE. It is not USDA inspected, it never carries the mark,
-- it can never be sold, and it must not commingle with inspected product.
-- Keeping it in its own table means "is this lot sellable?" is answered by
-- which table the row is in, not by reading a flag somebody might forget to
-- set. license_tag_no is a legal record: Montana requires the tag to stay with
-- the carcass, and we hold the animal on the strength of it.
--
-- ── Billing model ──────────────────────────────────────────────────────
-- Livestock bills off carcass weight (see lib/billingRules.ts). Game bills off
-- FINISHED weight, per service, because that is how the QBO items are already
-- written: WILD GAME PACKAGING $1.50/lb, GRINDING $1.75/lb, STICKS $4.50/lb,
-- STICKS W/CHEESE $5.25/lb, JERKY $11.00/lb, CLEANING FEE $60 flat. Those
-- items exist and are active in QuickBooks today, so game_outputs is the
-- billing source of record: one row per weighed category, priced by
-- lib/gameBilling.ts. Nothing here pushes to QuickBooks on its own — most
-- hunters pay at the register — the push is a button, and Jill still owns
-- invoicing.

-- ── The animal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_intakes (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),

  -- The claim number on the tag zip-tied to the animal and on the hunter's
  -- copy. Shape is WG-<yy>-<nnnn> (WG-26-0014) — deliberately unlike anything
  -- else the scanner sees: Hobart barcodes are 13 digits starting '2', cure
  -- seals are 7 digits starting '0', carcass tags are YYDDD-SEQ-SIDE.
  tag_number     text        NOT NULL UNIQUE,
  season         text        NOT NULL,          -- '2026' — the hunting season, for rollups

  -- ── Who ───────────────────────────────────────────────────────────────
  -- Hunters are overwhelmingly walk-ins we have never seen before, so the
  -- name and phone are typed and customer_id is a nice-to-have link, never a
  -- requirement. A blank customer_id means "not linked yet", never "unknown
  -- hunter" — the name field is mandatory precisely so attribution is never
  -- inferred later.
  hunter_name    text        NOT NULL,
  hunter_phone   text        NOT NULL DEFAULT '',
  hunter_email   text        NOT NULL DEFAULT '',
  customer_id    uuid        REFERENCES customers(id) ON DELETE SET NULL,
  qbo_customer_id text,                          -- set only if this one gets invoiced

  -- ── What ──────────────────────────────────────────────────────────────
  species        text        NOT NULL
                             CHECK (species IN ('Deer','Elk','Antelope','Buffalo',
                                                'Moose','Bear','Sheep','Goat','Other')),
  sex            text        NOT NULL DEFAULT '',
  -- Montana licence/tag number that came in with the animal. Legally this
  -- travels with the carcass; practically it is how we prove the meat in the
  -- cooler is somebody's lawful game and not unsourced product.
  license_tag_no text        NOT NULL DEFAULT '',
  hunting_district text      NOT NULL DEFAULT '',
  harvest_date   date,                           -- when it was shot, not when we got it

  -- ── How it showed up ──────────────────────────────────────────────────
  -- Drives everything downstream: a boned-out cooler skips the rail entirely,
  -- a hide-on whole animal is where the $60 cleaning fee comes from.
  condition      text        NOT NULL DEFAULT 'Quartered'
                             CHECK (condition IN ('Whole - Hide On','Whole - Skinned',
                                                  'Quartered','Boned Out','Other')),
  received_at    timestamptz NOT NULL DEFAULT now(),
  received_by    text        NOT NULL DEFAULT '',
  weight_in_lbs  numeric,                        -- as received, on our scale — the yield denominator

  -- ── Trophy / return items ─────────────────────────────────────────────
  -- Every one of these is a thing a hunter will drive back for and be angry
  -- about. They are columns, not notes, so they can be shown on the board.
  cape_requested    boolean  NOT NULL DEFAULT false,
  antlers_returned  boolean  NOT NULL DEFAULT false,
  hide_returned     boolean  NOT NULL DEFAULT false,
  -- The $60 WILD GAME CLEANING FEE: charged when the animal arrives dirty,
  -- hairy, or hide-on and has to be cleaned before it can be broken.
  cleaning_fee      boolean  NOT NULL DEFAULT false,

  -- ── Where it is right now ─────────────────────────────────────────────
  storage_location text      NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'received'
                             CHECK (status IN ('received','hanging','cutting',
                                               'value_add','packed','ready',
                                               'picked_up','abandoned')),

  -- ── What they want done ───────────────────────────────────────────────
  -- The wild game cut sheet. Shape is owned by lib/gameCuts.ts; kept as jsonb
  -- for the same reason cutting_instructions.data is — the option list moves
  -- every season and a migration per flavour is not a life.
  cut_sheet      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- ── The end ───────────────────────────────────────────────────────────
  ready_at       timestamptz,
  notified_at    timestamptz,                    -- when we told them it was ready
  picked_up_at   timestamptz,
  picked_up_by   text        NOT NULL DEFAULT '',
  notes          text        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_game_intakes_status   ON game_intakes(status);
CREATE INDEX IF NOT EXISTS idx_game_intakes_season   ON game_intakes(season);
CREATE INDEX IF NOT EXISTS idx_game_intakes_received ON game_intakes(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_intakes_hunter   ON game_intakes(lower(hunter_name));

-- ── The weighed output — one row per billable category ──────────────────
-- This is the till. A stick order that came off the smokehouse at 38.4 lbs is
-- one row; the burger is another. Rates are stamped onto the row at the time
-- it is weighed rather than looked up at invoice time, so re-pricing the
-- catalogue next season never silently rewrites last season's tickets.
CREATE TABLE IF NOT EXISTS game_outputs (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  intake_id    uuid        NOT NULL REFERENCES game_intakes(id) ON DELETE CASCADE,

  -- Billing category — the key into GAME_SERVICES in lib/gameBilling.ts.
  category     text        NOT NULL,
  -- What it actually is, in the crew's words: 'WILD GAME JALAPENO SNACK STICKS'.
  product_name text        NOT NULL DEFAULT '',
  plu          text,                             -- the scale PLU, when it has one
  weight_lbs   numeric     NOT NULL DEFAULT 0,

  -- Snapshot of the price used, so a printed ticket is reproducible.
  rate         numeric     NOT NULL DEFAULT 0,
  qbo_item_id  text        NOT NULL DEFAULT '',
  qbo_item_name text       NOT NULL DEFAULT '',
  -- true when somebody typed over the computed rate; the ticket flags it.
  rate_override boolean    NOT NULL DEFAULT false,
  notes        text        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_game_outputs_intake ON game_outputs(intake_id);

-- ── Added product: the fat and trim we sell INTO the grind ──────────────
-- Not an output — this is our beef/pork going out the door inside somebody
-- else's burger, and it is inventory, so it is priced and tracked separately
-- from the service lines. WILD GAME ADD BEEF FAT $2.59, ADD PORK FAT $1.79,
-- ADD PORK TRIM $2.79, ADD BEEF TRIM $4.99 — all live QBO items.
CREATE TABLE IF NOT EXISTS game_additions (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  intake_id    uuid        NOT NULL REFERENCES game_intakes(id) ON DELETE CASCADE,
  kind         text        NOT NULL
                           CHECK (kind IN ('beef_fat','pork_fat','beef_trim','pork_trim')),
  weight_lbs   numeric     NOT NULL DEFAULT 0,
  rate         numeric     NOT NULL DEFAULT 0,
  qbo_item_id  text        NOT NULL DEFAULT '',
  qbo_item_name text       NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_game_additions_intake ON game_additions(intake_id);

-- ── Movement log ────────────────────────────────────────────────────────
-- Status is a single column, which means the moment it changes the previous
-- state is gone. For an animal a hunter will phone about three times this
-- matters: "when did it go in the smokehouse", "who marked it ready", "when
-- did we call them". One row per transition, append only.
CREATE TABLE IF NOT EXISTS game_events (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  intake_id  uuid        NOT NULL REFERENCES game_intakes(id) ON DELETE CASCADE,
  event      text        NOT NULL,       -- 'status' | 'note' | 'notified' | 'weighed'
  detail     text        NOT NULL DEFAULT '',
  actor      text        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_game_events_intake ON game_events(intake_id, created_at DESC);

-- ── Claim-number allocator ──────────────────────────────────────────────
-- Two people at the drop-off window on a Saturday in November will otherwise
-- hand out the same number. A sequence per season, taken inside the insert.
CREATE TABLE IF NOT EXISTS game_tag_counters (
  season     text    PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_game_tag(p_season text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO game_tag_counters (season, last_value)
       VALUES (p_season, 1)
  ON CONFLICT (season) DO UPDATE SET last_value = game_tag_counters.last_value + 1
    RETURNING last_value INTO n;
  RETURN 'WG-' || right(p_season, 2) || '-' || lpad(n::text, 4, '0');
END;
$$;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION touch_game_intake()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_game_intake ON game_intakes;
CREATE TRIGGER trg_touch_game_intake
  BEFORE UPDATE ON game_intakes
  FOR EACH ROW EXECUTE FUNCTION touch_game_intake();

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Same posture as the assets register: RLS on so the tables are not bare, one
-- permissive app policy because cmc-app's own auth gate (branch `staff-gate`)
-- is what actually decides who gets in. Tightening these is part of the RLS
-- lockdown work, not this migration.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_intakes','game_outputs','game_additions',
                           'game_events','game_tag_counters']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t || '_app_access', t);
  END LOOP;
END $$;
