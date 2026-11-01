-- Wild Game module removed from the app (2026-11-01). Applied to production
-- the same day via the Supabase migration `drop_wild_game`; kept here so the
-- scripts/ folder still tells the whole story next to the 2026-08-24 scripts
-- that created these objects.
--
-- Checked before dropping: game_intakes, game_outputs, game_additions,
-- game_events and game_orders held zero rows. game_flavors (33), game_rates
-- (16) and game_tag_counters (1) held only seed data.
DROP TRIGGER IF EXISTS trg_touch_game_intake ON game_intakes;
DROP TABLE IF EXISTS game_additions CASCADE;
DROP TABLE IF EXISTS game_events CASCADE;
DROP TABLE IF EXISTS game_outputs CASCADE;
DROP TABLE IF EXISTS game_orders CASCADE;
DROP TABLE IF EXISTS game_intakes CASCADE;
DROP TABLE IF EXISTS game_flavors CASCADE;
DROP TABLE IF EXISTS game_rates CASCADE;
DROP TABLE IF EXISTS game_tag_counters CASCADE;
DROP FUNCTION IF EXISTS next_game_tag(text);
DROP FUNCTION IF EXISTS touch_game_intake();
