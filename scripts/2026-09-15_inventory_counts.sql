-- Physical inventory counts — the anchor under the meat on the balance sheet.
--
-- Jill, 2026-09-15: a way to true up inventory and push a figure to QuickBooks.
-- /exec has valued our own meat since 2026-09-04, but deliberately as FLOWS —
-- packed versus rung up — because nothing counts a package out of the case when
-- it sells. A count is what turns that into a level.
--
-- WHY NOT box_scans. The obvious shortcut is to reuse the scanner's table, and
-- it would be wrong: a box_scan means "this package was produced", and yield,
-- the packing list, the cut-card check-off and the /exec packed figure all read
-- it that way. A counted package was produced once, weeks ago. Writing counts
-- there would double every pound we make and break four things to save one
-- table.
--
-- NO FREEZE REQUIRED. Charlie chose month-end counting with the plant still
-- running, so the cutoff is a timestamp rather than a locked door: every line
-- carries the moment it was scanned, and the report cuts at an instant. That
-- only works if lines are never edited in place, which is why a miscount is
-- VOIDED rather than deleted.
--
-- Record-grade from the start, for the same reason cleaning_* is: per-person
-- attribution and immutable history are the two things that are expensive to
-- retrofit. If this ever has to support an auditor asking "who counted the
-- freezer on 30 September and what did they scan", the answer is already here.
--
-- RLS enabled with a permissive policy, matching how the rest of the app
-- reaches Supabase (anon key, gated at the app layer). These tables arrive
-- enrolled rather than adding to the anon-writable backlog.

-- ── One count: a person, a place, an as-of date ─────────────────────────

CREATE TABLE IF NOT EXISTS inventory_counts (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- The date the count is BOOKED at, which is not always the date it was
  -- walked: a count finished on the 1st can still be the 30th's balance.
  -- Jill keys the journal entry at this date.
  count_date  date        NOT NULL,

  -- 'Retail Case', 'Freezer', 'Cooler'. Free text on purpose — the plant will
  -- name its own corners, and an enum here would need a migration per corner.
  location    text        NOT NULL,

  status      text        NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'closed')),

  opened_by   text        NOT NULL DEFAULT '',
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_by   text,
  closed_at   timestamptz,

  notes       text        NOT NULL DEFAULT ''
);

-- Two people counting the same freezer on the same day is a mistake, not a
-- workflow — it double-counts the stock. One open count per place at a time.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_one_open_per_location
  ON inventory_counts (location)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS inventory_counts_date_idx
  ON inventory_counts (count_date DESC);

-- ── One scanned package ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- The scan moment. This IS the cutoff mechanism; do not backfill it.
  created_at  timestamptz NOT NULL DEFAULT now(),

  count_id    uuid        NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,

  plu_number  text        NOT NULL,
  -- Snapshot, so renaming or retiring a PLU next year never rewrites what this
  -- count said was in the freezer. Same reason cleaning shift items snapshot
  -- their titles.
  item_name   text        NOT NULL DEFAULT '',

  -- Off the Hobart barcode, digits 8-12 ÷ 100. Null for an each-priced item
  -- whose label carries no weight, where quantity is the whole count.
  weight_lbs  numeric,
  quantity    int         NOT NULL DEFAULT 1,

  -- What the gun actually read, kept so a weight that looks wrong later can be
  -- checked against what the scale printed.
  barcode     text        NOT NULL DEFAULT '',
  counted_by  text        NOT NULL DEFAULT '',

  -- A miscount is voided, never deleted: the count has to stay reconstructable
  -- at any instant, and a row that vanishes takes its timestamp with it.
  voided_at   timestamptz,
  voided_by   text,
  void_reason text
);

CREATE INDEX IF NOT EXISTS inventory_count_lines_count_idx
  ON inventory_count_lines (count_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_count_lines_live_idx
  ON inventory_count_lines (count_id, plu_number)
  WHERE voided_at IS NULL;

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE inventory_counts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_counts_all ON inventory_counts;
CREATE POLICY inventory_counts_all ON inventory_counts
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventory_count_lines_all ON inventory_count_lines;
CREATE POLICY inventory_count_lines_all ON inventory_count_lines
  FOR ALL USING (true) WITH CHECK (true);
