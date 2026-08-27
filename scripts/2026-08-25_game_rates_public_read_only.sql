-- The price list becomes readable by a PUBLIC page (the hunter's order form
-- reads game_rates and game_flavors to show what we make and what it costs).
-- It was sitting on a FOR ALL policy, which means the anon key could rewrite
-- our prices. That was already true; putting a public form in front of it makes
-- it discoverable, which is a different thing.
--
-- Prices are public information — they are printed on a slip we hand out — so
-- anon keeps SELECT. Writes move behind the service role: cmc-app's Pricing tab
-- goes through /api/game/rates, which now uses supabaseAdmin.

DROP POLICY IF EXISTS game_rates_app_access   ON game_rates;
DROP POLICY IF EXISTS game_flavors_app_access ON game_flavors;

CREATE POLICY game_rates_public_read ON game_rates
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY game_flavors_public_read ON game_flavors
  FOR SELECT TO anon, authenticated USING (true);

-- No INSERT/UPDATE/DELETE policy for anon: with RLS on, that is a default deny.
-- Staff edits are server-side under the service role. Do not "fix" a failing
-- price save by adding a permissive write policy here — check the route is
-- using supabaseAdmin instead.
