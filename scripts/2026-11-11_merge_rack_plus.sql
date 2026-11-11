-- Merge PLU 2101 "LAMB RACK" into PLU 2102 "LAMB RACK FRENCH TIPPED".
--
-- Charlie, 2026-11-03 (/scanner feedback): "Lamb rack and French tip lamb rack
-- are the same thing." 2026-11-11: "merge them."
--
-- 2102 survives because it is what the floor actually uses: 51 box scans
-- (last 2026-11-09), 4 inventory count lines, and the lamb "rack" cut link the
-- packing session expects. 2101 has 2 scans (last 2026-07-02), one fulfilled
-- order line, and the Clover item, QuickBooks item and order-catalog product.
-- Those three move onto 2102 so nothing downstream loses its mapping.
--
-- 2101 is deactivated, not deleted. clover_push_log / qbo_push_log rows are
-- history and stay as they were.
--
-- Applied 2026-11-11 after Charlie confirmed: keep the name LAMB RACK FRENCH TIPPED,
-- price $26.99.

begin;

-- Order matters: plu_items has an UPDATE trigger (products_price_sync →
-- sync_product_from_plu) that rewrites the linked catalog product's price and
-- sets it active only when the PLU is active, retail and priced. Repoint the
-- product first, so deactivating 2101 can't switch the "Lamb Rack" product off,
-- and carry 2101's retail flag over so the trigger keeps it on at $26.99.

-- 1. The order catalog's "Lamb Rack" product points at the survivor.
update products set plu_item_id = '3878489c-c9fe-4a61-b615-0940273600f4'   -- plu_items 2102
where id = '42ef97f7-d86a-4bab-894e-b268ed46431c';                          -- products "Lamb Rack"

-- 2. The survivor takes the selling identity off 2101 (trigger then sets the
--    catalog product to $26.99, active).
update plu_items set
  item_name          = 'LAMB RACK FRENCH TIPPED', -- Charlie, 2026-11-11
  price              = 26.99,                      -- Charlie, 2026-11-11 (2102 was 23.99)
  retail_price       = 26.99,
  is_retail          = true,                       -- from 2101
  clover_item_id     = '1FGZ7QB3S5YH2',            -- from 2101
  quickbooks_item_id = '1138',                     -- from 2101
  updated_at         = now()
where plu_number = '2102';

-- 3. The old PLU stops being pickable and stops claiming the Clover/QBO items.
update plu_items set
  active             = false,
  clover_item_id     = '',                         -- column is NOT NULL; '' is how a PLU says "none"
  quickbooks_item_id = '',
  notes              = btrim(coalesce(notes, '') || E'\nMerged into PLU 2102 on 2026-11-11.', E'\n '),
  updated_at         = now()
where plu_number = '2101';

-- 4. History moves with it, so reports count one item.
update box_scans          set plu_number = '2102', item_name = 'LAMB RACK FRENCH TIPPED' where plu_number = '2101';   -- 2 rows
update retail_order_items set plu_number = '2102'                          where plu_number = '2101';   -- 1 row (Pat Johnson, fulfilled)

-- Expect: 2101 inactive with 0 scans; 2102 active, retail, $26.99, 53 scans;
-- catalog product "Lamb Rack" active at $26.99 on 2102.
select plu_number, item_name, active, price, clover_item_id, quickbooks_item_id,
       (select count(*) from box_scans b where b.plu_number = p.plu_number) scans
from plu_items p where plu_number in ('2101', '2102');
select name, price, active, plu_item_id from products where id = '42ef97f7-d86a-4bab-894e-b268ed46431c';

commit;

-- ── Goat rack, same day (Charlie, 2026-11-11: "merge goat too") ──────────────
-- 3101 GOAT RACK had nothing pointing at it: 0 scans, no orders, counts,
-- catalog product, Clover or QuickBooks link, and the same $23.99 price. 3102
-- GOAT RACK FRENCH TIPPED keeps its 10 scans and the goat "rack" cut link, so
-- the merge is retiring 3101.
update plu_items set
  active     = false,
  notes      = btrim(coalesce(notes, '') || E'\nMerged into PLU 3102 on 2026-11-11.', E'\n '),
  updated_at = now()
where plu_number = '3101';
