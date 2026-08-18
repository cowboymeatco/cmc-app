-- Asset register — one record per physical thing the business owns.
--
-- The point is that a machine is not three things. The band saw is
-- simultaneously something the night crew tears down, something that needs
-- servicing, and $20,000 of depreciating capital. Those are views of one
-- record, so there is one table and each screen reads the slice it needs.
--
-- ── Why this is additive rather than a rename ───────────────────────────
-- cleaning_equipment is empty, so promoting it to `assets` would normally be
-- free. But the worktree this was written in isolates code, not the database —
-- production runs against this same Postgres and its live code still selects
-- from cleaning_equipment. Renaming would break the running app the moment it
-- was applied. So `assets` arrives alongside, the cleaning module is repointed
-- at it in the same branch, and cleaning_equipment gets dropped only once that
-- code is deployed. Zero downtime, and it still ends as one record.
--
-- ── What QuickBooks can and cannot give us ──────────────────────────────
-- Probed 2026-08-17 against the live books:
--   * 10 fixed-asset accounts, $746,611.93 gross
--   * 5 machines ARE itemized: Biro 3330 Band Saw ($20,000), Thompson 3200
--     Grinder ($40,000), Multivac Rollstock ($68,429.30), 2023 Hobart Scale
--     ($4,514), 50# Hobart Box Scale ($5,673.48)
--   * $428,889.10 sits in ONE undifferentiated "Machinery & Equipment" account
--   * Accumulated depreciation is a SINGLE account (-$93,048.63), not per
--     asset — so per-machine book value is NOT derivable from QuickBooks, only
--     gross cost on the accounts that happen to be itemized, and only a
--     company-wide depreciation figure.
-- Hence qbo_account_id is nullable and purchase_cost is stored here: most
-- assets will never have a QuickBooks account of their own.

CREATE TABLE IF NOT EXISTS assets (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  -- ── Identity ──────────────────────────────────────────────────────────
  name          text        NOT NULL,
  make          text,
  model         text,
  serial_number text,
  asset_tag     text UNIQUE,          -- our own sticker, if we ever tag them
  category      text        NOT NULL DEFAULT 'equipment'
                            CHECK (category IN (
                              'equipment',    -- machines on the floor
                              'vehicle',
                              'building',     -- leasehold / capital improvements
                              'software',
                              'fixture',      -- coolers, racks, sinks
                              'other')),

  -- ── Where it is ───────────────────────────────────────────────────────
  area_id       uuid        REFERENCES cleaning_areas(id) ON DELETE SET NULL,
  -- Position on the plant map. Null means "not placed yet"; the map parks
  -- those rather than hiding them. Same convention as cleaning_areas.
  map_x         numeric,
  map_y         numeric,

  -- ── The cleaning view ─────────────────────────────────────────────────
  -- A truck and a leasehold improvement are assets but are not on anyone's
  -- nightly list, so the cleaning screens filter on this rather than showing
  -- every capital item to the night crew.
  cleanable     boolean     NOT NULL DEFAULT true,

  -- ── The maintenance view ──────────────────────────────────────────────
  service_interval_days int,           -- null = no scheduled service
  last_serviced_on      date,
  service_notes         text,
  -- in_service is the normal state; 'down' is what makes an asset urgent, and
  -- what capacity planning would need to read.
  status        text        NOT NULL DEFAULT 'in_service'
                            CHECK (status IN ('in_service','down','retired','spare')),

  -- ── The financial view ────────────────────────────────────────────────
  purchase_cost     numeric,
  purchase_date     date,
  vendor            text,
  -- Straight-line life in years, for a book value the app can show. Kept here
  -- rather than read from QuickBooks because QuickBooks holds only one pooled
  -- accumulated-depreciation account.
  useful_life_years numeric,
  salvage_value     numeric,
  -- What it would cost to replace today — the number that matters for
  -- insurance, and the one QuickBooks never holds.
  replacement_cost  numeric,
  -- Set only for the handful of machines QuickBooks itemizes, so the app can
  -- show the books' own figure beside ours instead of a parallel number that
  -- drifts.
  qbo_account_id    text,
  qbo_account_name  text,

  photo_url     text,
  notes         text,
  active        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_assets_area      ON assets(area_id);
CREATE INDEX IF NOT EXISTS idx_assets_cleanable ON assets(cleanable) WHERE active;
CREATE INDEX IF NOT EXISTS idx_assets_status    ON assets(status);

-- Service history. Separate rows rather than overwriting last_serviced_on, so
-- "how often does this thing actually break" is answerable later — which is
-- the question that justifies replacing a machine.
CREATE TABLE IF NOT EXISTS asset_service_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  asset_id     uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  serviced_on  date        NOT NULL,
  kind         text        NOT NULL DEFAULT 'routine'
                           CHECK (kind IN ('routine','repair','inspection','install')),
  performed_by text,
  vendor       text,
  cost         numeric,
  downtime_hours numeric,
  description  text,
  photo_url    text
);

CREATE INDEX IF NOT EXISTS idx_asset_service_asset ON asset_service_log(asset_id, serviced_on DESC);

ALTER TABLE assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_service_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets','asset_service_log']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t || '_app_access', t);
  END LOOP;
END $$;

-- ── Repoint the cleaning module at assets ───────────────────────────────
-- cleaning_equipment is empty, so these carry no data across. The old table is
-- left in place for now: production is still running code that reads it, and
-- it gets dropped once this branch is deployed.

ALTER TABLE cleaning_steps
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE cleaning_step_suggestions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE cleaning_tasks
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE cleaning_shift_items
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE cleaning_issues
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cleaning_steps_asset ON cleaning_steps(asset_id, phase, step_no);

-- The old (equipment_id, phase, step_no) uniqueness has to have an asset-based
-- twin, or two steps could claim the same number on one machine.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cleaning_steps_asset_phase_no
  ON cleaning_steps(asset_id, phase, step_no) WHERE asset_id IS NOT NULL;
