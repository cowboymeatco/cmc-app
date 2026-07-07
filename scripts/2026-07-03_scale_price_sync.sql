-- 2026-07-03: Sync scale prices (plu_items.price) to register truth (retail_price)
-- for Clover-linked items, so label totals match what the register charges.
-- Context: barcode codes were fixed the same day (see clover_push_log); this closes
-- the remaining label-vs-register gap. Applied to prod via Supabase MCP 2026-07-03.
--
-- Direction of truth: retail_price == live Clover price for all linked items
-- (seeded/verified against the register catalog today). Two deliberate EXCLUSIONS:
--   6100 BEEF HOT DOGS  (scale 9.99 vs register 8.99)
--   6104 POLISH SAUSAGE (scale 9.99 vs register 8.99)
-- Charlie's 2026-07-02 decision was "all dogs flat $9.99"; the register still has
-- 8.99 because write-back didn't exist yet. Held for Charlie: either push 9.99 to
-- Clover from the app, or lower these two in the app.
-- Also fixed by this script: 1132 PORK FAT ($7.49 was leftover hickory-bacon price)
-- and 1134 JUMPSTART LINKS ($1.79 was leftover pork-fat price) from the 7/02 renames.

-- ── 1. Scale price = register price for linked items (51 rows) ──
update plu_items
set price = retail_price, updated_at = now()
where active
  and clover_item_id <> ''
  and retail_price > 0
  and price is distinct from retail_price
  and plu_number not in ('6100', '6104');

-- ── 2. PLU 106 BEEF BOTTOM ROUND ROAST: register was raised to 6.99 after the
--       7/02 exercise priced it 5.49 — accept the register value into the app ──
update plu_items
set price = 6.99, retail_price = 6.99, updated_at = now()
where plu_number = '106';

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (old scale prices captured 2026-07-03 before the change):
-- update plu_items set price = 16.99 where plu_number = '121';  -- BEEF BONE-IN RIB ROAST
-- update plu_items set price = 17.99 where plu_number = '116';  -- BEEF BONE-IN RIB STEAK
-- update plu_items set price = 18.99 where plu_number = '115';  -- BEEF BONELESS RIBEYE STEAK
-- update plu_items set price = 7.49  where plu_number = '102';  -- BEEF CHUCK ROAST
-- update plu_items set price = 2.59  where plu_number = '152';  -- BEEF FAT
-- update plu_items set price = 13.49 where plu_number = '103';  -- BEEF FLAT IRON STEAK
-- update plu_items set price = 3.99  where plu_number = '130';  -- BEEF HEART
-- update plu_items set price = 3.99  where plu_number = '160';  -- BEEF KNUCKLE BONES
-- update plu_items set price = 3.99  where plu_number = '131';  -- BEEF LIVER
-- update plu_items set price = 3.99  where plu_number = '161';  -- BEEF MARROW BONES
-- update plu_items set price = 16.49 where plu_number = '114';  -- BEEF NEW YORK STEAK
-- update plu_items set price = 3.99  where plu_number = '159';  -- BEEF RIB BONES
-- update plu_items set price = 7.69  where plu_number = '167';  -- BEEF SAUSAGE
-- update plu_items set price = 9.99  where plu_number = '118';  -- BEEF SIRLOIN STEAK
-- update plu_items set price = 9.99  where plu_number = '127';  -- BEEF SKIRT STEAK
-- update plu_items set price = 7.49  where plu_number = '129';  -- BEEF STEW MEAT
-- update plu_items set price = 14.99 where plu_number = '119';  -- BEEF T-BONE STEAK
-- update plu_items set price = 23.99 where plu_number = '120';  -- BEEF TENDERLOIN ROAST
-- update plu_items set price = 18.99 where plu_number = '153';  -- BEEF TOMAHAWK STEAK
-- update plu_items set price = 12.49 where plu_number = '124';  -- BEEF TRI-TIP ROAST
-- update plu_items set price = 7.49  where plu_number = '135';  -- EXTRA LEAN GROUND BEEF 90/10
-- update plu_items set price = 11.99 where plu_number = '2110'; -- GROUND LAMB
-- update plu_items set price = 7.99  where plu_number = '194';  -- ITALIAN GROUND BEEF
-- update plu_items set price = 9.99  where plu_number = '2117'; -- LAMB BROTWURST
-- update plu_items set price = 19.99 where plu_number = '2100'; -- LAMB CHOPS
-- update plu_items set price = 6.99  where plu_number = '2118'; -- LAMB FAT
-- update plu_items set price = 5.99  where plu_number = '2115'; -- LAMB HEART
-- update plu_items set price = 15.99 where plu_number = '2107'; -- LAMB LEG STEAKS
-- update plu_items set price = 5.99  where plu_number = '2116'; -- LAMB LIVER
-- update plu_items set price = 5.99  where plu_number = '2109'; -- LAMB NECK
-- update plu_items set price = 23.99 where plu_number = '2101'; -- LAMB RACK
-- update plu_items set price = 11.99 where plu_number = '2103'; -- LAMB RIBLETS
-- update plu_items set price = 12.99 where plu_number = '9004'; -- LAMB SAUSAGE
-- update plu_items set price = 14.99 where plu_number = '2113'; -- LAMB SHANK
-- update plu_items set price = 9.99  where plu_number = '2104'; -- LAMB SHOULDER ROAST
-- update plu_items set price = 12.99 where plu_number = '2108'; -- LAMB STEW MEAT
-- update plu_items set price = 10.99 where plu_number = '2111'; -- LAMB TRIM
-- update plu_items set price = 2.00  where plu_number = '1';    -- MEAT BOX
-- update plu_items set price = 5.99  where plu_number = '1101'; -- PORK CHOPS
-- update plu_items set price = 5.29  where plu_number = '1104'; -- PORK COUNTRY STYLE RIBS
-- update plu_items set price = 7.49  where plu_number = '1132'; -- PORK FAT (stale bacon price)
-- update plu_items set price = 6.29  where plu_number = '1107'; -- PORK FRESH HAM STEAK
-- update plu_items set price = 6.49  where plu_number = '1105'; -- PORK FRESH SIDE
-- update plu_items set price = 6.49  where plu_number = '1119'; -- PORK HAM HOCK CURED
-- update plu_items set price = 6.29  where plu_number = '1117'; -- PORK HAM ROAST CURED
-- update plu_items set price = 7.29  where plu_number = '1118'; -- PORK HAM STEAK CURED
-- update plu_items set price = 7.49  where plu_number = '1130'; -- PORK HONEY BACON
-- update plu_items set price = 4.99  where plu_number = '1125'; -- PORK ITALIAN SAUSAGE
-- update plu_items set price = 4.99  where plu_number = '1124'; -- PORK JUMPSTART SAUSAGE
-- update plu_items set price = 1.79  where plu_number = '1134'; -- PORK JUMPSTART SAUSAGE LINKS (stale fat price)
-- update plu_items set price = 6.49  where plu_number = '1126'; -- PORK SAUSAGE LINKS
-- update plu_items set price = 5.49, retail_price = 5.49 where plu_number = '106'; -- BEEF BOTTOM ROUND ROAST
