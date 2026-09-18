-- Inventory counts: count a sealed box by its label instead of package by package.
--
-- Charlie, 2026-09-18: count both — box labels for sealed freezer boxes, package
-- labels for the loose retail case. A box scan expands into the packages the
-- scanner recorded going INTO that box, one count line each, so every tally
-- keeps working on packages and never has to know a box was involved.
--
-- The lines remember which box they came from so that:
--   * the same box scanned twice in one count is refused, not double-counted
--   * a box counted by mistake is voided as a unit, not package by package
--   * a loose package that matches one inside an already-counted box (same PLU,
--     same weight to the hundredth) can be flagged as probably counted twice —
--     a Hobart package label carries no box identity of its own
--
-- Additive only.

ALTER TABLE inventory_count_lines
  ADD COLUMN IF NOT EXISTS box_id     uuid REFERENCES boxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS box_serial text;

CREATE INDEX IF NOT EXISTS inventory_count_lines_box_idx
  ON inventory_count_lines (count_id, box_id)
  WHERE voided_at IS NULL AND box_id IS NOT NULL;
