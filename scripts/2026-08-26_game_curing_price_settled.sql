-- Curing: the app and QuickBooks now agree at $2.50/lb.
--
-- The printed Wild Game Processing slip says $2.50; QuickBooks item 97
-- (SERVICE INCOME:WILD GAME CURING) said $2.00. Charlie settled it on
-- 2026-08-26 in favour of the slip, and item 97 was raised to $2.50 IN
-- QUICKBOOKS — an external change this repo cannot make for you, recorded here
-- so the reason does not live only in somebody's memory.
--
-- Every one of the 19 wild game rates (plain and with-cheese) was then checked
-- against LIVE QuickBooks, not the cached copy, and all of them match.
--
-- Nothing here re-prices existing work: rates are stamped onto game_outputs at
-- weigh-out, so a price change only ever affects animals weighed after it.

UPDATE game_rates SET
  note       = 'Slip price. QuickBooks item 97 was $2.00 and was changed to $2.50 on 2026-08-26 so the two agree.',
  updated_at = now(),
  updated_by = 'CB'
WHERE key = 'curing';

-- qbo_items is only a cache of QuickBooks and the next full sync overwrites it,
-- but leaving it at 2.00 would have the QuickBooks tab reporting a
-- disagreement that no longer exists.
UPDATE qbo_items SET sales_price = 2.50, synced_at = now() WHERE qbo_id = '97';
