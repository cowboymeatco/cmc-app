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
-- NOT YET APPLIED. Run as one transaction after Charlie signs off on the name
-- and price below.

begin;

-- 1. The survivor takes the single name and the selling identity off 2101.
update plu_items set
  item_name          = 'LAMB RACK',               -- confirm wording
  price              = 26.99,                      -- 2101 retail price; 2102 was 23.99 — confirm
  retail_price       = 26.99,
  clover_item_id     = '1FGZ7QB3S5YH2',            -- from 2101
  quickbooks_item_id = '1138',                     -- from 2101
  updated_at         = now()
where plu_number = '2102';

-- 2. The old PLU stops being pickable and stops claiming the Clover/QBO items.
update plu_items set
  active             = false,
  clover_item_id     = null,
  quickbooks_item_id = null,
  notes              = trim(both from coalesce(notes, '') || E'\nMerged into PLU 2102 on 2026-11-11.'),
  updated_at         = now()
where plu_number = '2101';

-- 3. The order catalog's "Lamb Rack" product points at the survivor.
update products set plu_item_id = '3878489c-c9fe-4a61-b615-0940273600f4'   -- plu_items 2102
where id = '42ef97f7-d86a-4bab-894e-b268ed46431c';                          -- products "Lamb Rack"

-- 4. History moves with it, so reports count one item.
update box_scans          set plu_number = '2102', item_name = 'LAMB RACK' where plu_number = '2101';   -- 2 rows
update box_scans          set item_name  = 'LAMB RACK'                     where plu_number = '2102';   -- 51 rows
update retail_order_items set plu_number = '2102'                          where plu_number = '2101';   -- 1 row (Pat Johnson, fulfilled)

-- Expect: 2101 inactive with 0 scans; 2102 active with 53 scans.
select plu_number, item_name, active, price, clover_item_id, quickbooks_item_id,
       (select count(*) from box_scans b where b.plu_number = p.plu_number) scans
from plu_items p where plu_number in ('2101', '2102');

commit;
