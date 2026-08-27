-- Put wild game on the SAME stage names as the rest of the plant:
--   Receiving -> Processing -> Value Add -> Freezer -> Picked Up
--
-- The first cut (2026-08-24_wild_game.sql) invented its own vocabulary
-- (hanging / cutting / packed / ready), which meant the game board and the ERP
-- described the same building in two different languages. Nobody should have to
-- learn a second set of station names for one species. That CHECK constraint is
-- superseded here.
--
-- Two of the old statuses had nowhere to go and that is the point:
--   * 'hanging' is a rail state, and game arrives boned out - there is no rail.
--     It folds into Receiving: arrived, nobody has touched it yet.
--   * 'packed' and 'ready' were the same physical fact - it is in the freezer
--     waiting for a hunter. Whether they have been TOLD is notified_at, which
--     is already its own column, so the board can still show "in the freezer,
--     not called" without a status for it.

ALTER TABLE game_intakes DROP CONSTRAINT IF EXISTS game_intakes_status_check;

UPDATE game_intakes SET status = CASE status
  WHEN 'received'  THEN 'receiving'
  WHEN 'hanging'   THEN 'receiving'
  WHEN 'cutting'   THEN 'processing'
  WHEN 'packed'    THEN 'freezer'
  WHEN 'ready'     THEN 'freezer'
  ELSE status
END;

ALTER TABLE game_intakes ALTER COLUMN status SET DEFAULT 'receiving';

ALTER TABLE game_intakes ADD CONSTRAINT game_intakes_status_check
  CHECK (status IN ('receiving','processing','value_add','freezer','picked_up','abandoned'));
