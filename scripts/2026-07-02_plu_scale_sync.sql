-- 2026-07-02: Sync plu_items names to the Hobart scale (source: C:\Users\charl\Downloads\backup.ht, exported 2026-06-26)
-- Trigger: crew feedback "diced beef coming up as beef chuck ribs" (/scanner, Jun 30).
-- Full diff of all 367 scale PLUs vs plu_items found 7 name mismatches + 26 PLUs missing from the app.
-- Applied directly to prod via Supabase MCP on 2026-07-02. Rollback statements at the bottom.

-- ── 1. Rename mismatched PLUs to the scale's names (scale is what prints labels) ──
update plu_items set item_name = 'MEAT BOX'                     where plu_number = '1';    -- was BEEF MEAT BOX
update plu_items set item_name = 'ARM ROAST CASE'               where plu_number = '2';    -- was ARM ROAST
update plu_items set item_name = 'BEEF EYE OF ROUND ROAST'      where plu_number = '4';    -- was EYE OF ROUND ROAST
update plu_items set item_name = 'BEEF KIDNEY FAT GRASSFED'     where plu_number = '134';  -- was BEEF KIDNEY
update plu_items set item_name = 'DICED BEEF'                   where plu_number = '188';  -- was BEEF CHUCK RIBS  ← the reported bug
update plu_items set item_name = 'PORK FAT'                     where plu_number = '1132'; -- was PORK HICKORY BACON
update plu_items set item_name = 'PORK JUMPSTART SAUSAGE LINKS' where plu_number = '1134'; -- was PORK FAT

-- ── 2. Add scale PLUs missing from the app (scanned as "Unknown Item (PLU x)") ──
insert into plu_items (plu_number, item_name, price, tare_weight, department, unit, species, is_retail, is_wholesale, active)
values
  ('3',      'BONELESS PORK CHOP',                                          0.01, 0, '0', '02', 'Pork',      false, false, true),
  ('5115',   'HABANERO CHEDDAR SUMMER SAUSAGE',                             0.01, 0, '0', '02', 'Processed', false, false, true),
  ('6129',   'BEEF CHEDDAR COUNTRY BROTWURST',                              0.01, 0, '0', '02', 'Processed', false, false, true),
  ('6130',   'HAWAIIAN BROTWURST',                                          0.01, 0, '0', '02', 'Processed', false, false, true),
  ('7115',   'BIG SKY GARLIC BEEF JERKY',                                   0.01, 0, '0', '02', 'Processed', false, false, true),
  ('9004',   'LAMB SAUSAGE',                                                0.01, 0, '0', '02', 'Lamb',      false, false, true),
  ('413001', 'BEEF FORESHANK STEAK',                                        0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413002', 'BEEF CHUCK EYE ROLL',                                         0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413003', 'BEEF BONES',                                                  0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413004', 'BEEF ROUND, TOP (INSIDE), CAP OFF',                           0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413005', 'BEEF ROUND, EYE OF ROUND',                                    0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413006', 'BEEF LOIN, SIRLOIN BUTT, TRIMMED, BONELESS',                  0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413007', 'BEEF LOIN, BOTTOM SIRLOIN BUTT, TRI-TIP, DEFATTED, BONELESS', 0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413008', 'DICED BEEF',                                                  0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413009', 'BEEF LOIN, STRIP LOIN, BONELESS',                             0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413010', 'BEEF LOIN, TENDERLOIN, FULL, SIDE MUSCLE, SKINNED',           0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413011', 'BEEF SHORT RIBS',                                             0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413012', 'BEEF RIB, RIBEYE ROLL',                                       0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413013', 'BEEF FLANK, FLANK STEAK',                                     0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413014', 'BEEF BRISKET',                                                0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413015', 'GROUND BEEF',                                                 0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413016', 'BEEF LIVER',                                                  0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413018', 'BEEF HEART NOT FOR HUMAN CONSUMPTION',                        0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413019', 'BEEF OXTAIL',                                                 0.01, 0, '0', '02', 'Beef',      false, true,  true),
  ('413020', 'BEEF ORGANS',                                                 0.01, 0, '0', '02', 'Beef',      false, true,  true)
on conflict (plu_number) do nothing;

-- ── 3. Correct the 23 mislabeled scans from Jun 30 (physically diced beef, recorded as chuck ribs) ──
update box_scans set item_name = 'DICED BEEF' where plu_number = '188' and item_name = 'BEEF CHUCK RIBS';

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (previous values, captured 2026-07-02 before the change):
-- update plu_items set item_name = 'BEEF MEAT BOX'      where plu_number = '1';
-- update plu_items set item_name = 'ARM ROAST'          where plu_number = '2';
-- update plu_items set item_name = 'EYE OF ROUND ROAST' where plu_number = '4';
-- update plu_items set item_name = 'BEEF KIDNEY'        where plu_number = '134';
-- update plu_items set item_name = 'BEEF CHUCK RIBS'    where plu_number = '188';
-- update plu_items set item_name = 'PORK HICKORY BACON' where plu_number = '1132';
-- update plu_items set item_name = 'PORK FAT'           where plu_number = '1134';
-- delete from plu_items where plu_number in ('3','5115','6129','6130','7115','9004','413001','413002','413003','413004','413005','413006','413007','413008','413009','413010','413011','413012','413013','413014','413015','413016','413018','413019','413020');
-- update box_scans set item_name = 'BEEF CHUCK RIBS' where plu_number = '188' and item_name = 'DICED BEEF' and created_at::date = '2026-06-30';
