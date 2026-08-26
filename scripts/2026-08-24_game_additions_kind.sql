-- game_additions.kind was its own vocabulary ('beef_fat'); it now has to BE the
-- game_rates key ('add_beef_fat') so a line can price itself by looking the key
-- up. Two names for one thing is how a lookup silently returns nothing.
UPDATE game_additions SET kind = 'add_' || kind WHERE kind NOT LIKE 'add\_%';

ALTER TABLE game_additions DROP CONSTRAINT IF EXISTS game_additions_kind_check;
ALTER TABLE game_additions ADD CONSTRAINT game_additions_kind_check
  CHECK (kind IN ('add_beef_fat','add_pork_fat','add_beef_trim','add_pork_trim'));
