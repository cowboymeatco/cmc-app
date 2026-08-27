-- A cheese product is a different QuickBooks item, not just a different price.
-- WILD GAME STICKS is item 94 at $4.50; WILD GAME STICKS W/CHEESE is item 93 at
-- $5.25. Booking a cheese line against the plain item bills the right money into
-- the wrong account, which is the kind of error that only shows up at year end.
ALTER TABLE game_rates
  ADD COLUMN IF NOT EXISTS cheese_qbo_item_id   text,
  ADD COLUMN IF NOT EXISTS cheese_qbo_item_name text;

UPDATE game_rates SET cheese_qbo_item_id = '93', cheese_qbo_item_name = 'WILD GAME STICKS W/CHEESE'
 WHERE key = 'sticks';
UPDATE game_rates SET cheese_qbo_item_id = '91', cheese_qbo_item_name = 'WILD GAME SALAMI/SUMMERS W/CHEESE'
 WHERE key = 'summer';
UPDATE game_rates SET cheese_qbo_item_id = '85', cheese_qbo_item_name = 'WILD GAME BROTWURST WITH CHEESE'
 WHERE key = 'brotwurst';
