-- Clover register sales → QuickBooks, one business day at a time (2026-09-27).
--
-- NOT APPLIED. Charlie, 2026-09-26: this does not roll out until Jill is done
-- entering register sales by hand. Apply it together with setting
-- CLOVER_SALES_POSTING_FROM (the first day the app posts) — see
-- lib/qboDailySales.ts.
--
-- Service role only (RLS on, no policies): these rows say what was written to
-- the books and by whom; the routes read and write them through supabaseAdmin.

-- One row per business day the app has posted, or tried to. business_date is
-- the primary key, so the same day can never be claimed for posting twice.
create table if not exists public.clover_daily_sales (
  business_date      date primary key,               -- Mountain Time day
  status             text not null check (status in ('posting', 'posted', 'error')),
  fingerprint        text not null,                  -- Clover's numbers as posted
  last_fingerprint   text,                           -- Clover's numbers at the last re-read
  changed_after_post boolean not null default false, -- late refund / edited ticket
  summary            jsonb not null,                 -- lib/cloverSales DaySummary
  proposal           jsonb not null,                 -- what was approved
  qbo_invoice_id     text,
  qbo_invoice_doc    text,
  qbo_payment_ids    text[] not null default '{}',
  qbo_journal_id     text,
  approved_by        text,
  posted_at          timestamptz,
  last_checked_at    timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Every QuickBooks write (and claim / re-check), like qbo_push_log.
create table if not exists public.clover_daily_sales_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  business_date  date not null,
  step           text not null,          -- claim | invoice | payment:card | journal | posted | changed-after-post
  status         text not null check (status in ('ok', 'error')),
  qbo_id         text,
  amount_cents   bigint,
  request        jsonb,
  error          text,
  actor          text
);
create index if not exists clover_daily_sales_log_day on public.clover_daily_sales_log (business_date, created_at desc);

-- Clover item → QuickBooks item, as a person chose it on /billing. Checked
-- before the PLU links and name matching (lib/qboDailySales mapItems).
create table if not exists public.clover_qbo_item_map (
  clover_item_id  text primary key,
  clover_name     text,
  qbo_item_id     text not null,
  qbo_item_name   text,
  updated_by      text,
  updated_at      timestamptz not null default now()
);

alter table public.clover_daily_sales enable row level security;
alter table public.clover_daily_sales_log enable row level security;
alter table public.clover_qbo_item_map enable row level security;

-- Seeded from Jill's own entries (2026-09-27): for each day from 2026-08-12 to
-- 2026-09-25 whose Clover retail total equalled her CMC invoice to the cent, each
-- Clover item was paired with the invoice line of the same amount. Only pairings
-- that never disagreed are here (70); "Sockeye Salmon" went to two different
-- items and is left for a person.
insert into public.clover_qbo_item_map (clover_item_id, clover_name, qbo_item_id, qbo_item_name, updated_by) values
  ('0ZHX17S9SBTVE', '85% LEAN 15% FAT GROUND BEEF', '1102', '85% LEAN 15% FAT GROUND BEEF', 'seeded from Jill''s CMC invoices (17 days)'),
  ('83K8RSSQAE0ZC', '90% LEAN 10% FAT GROUND BEEF', '1101', '90% LEAN 10% FAT GROUND BEEF', 'seeded from Jill''s CMC invoices (5 days)'),
  ('HJJJE13PTGSYE', 'Alpine Touch 5-7.5 oz. Containers', '1390', 'ALPINE TOUCH SEASONINGS 5-7.5 OZ. CONTAINERS', 'seeded from Jill''s CMC invoices (2 days)'),
  ('V17TG6GV01G48', 'Alpine Touch 8-11.5 oz. Containers', '1391', 'ALPINE TOUCH SEASONINGS 8-11.5 OZ', 'seeded from Jill''s CMC invoices (1 day)'),
  ('2B0DPDPY5D4A6', 'ARM STEAK', '1104', 'BEEF ARM STEAK', 'seeded from Jill''s CMC invoices (1 day)'),
  ('9H1N4AHVNVM9C', 'Becky''s Berries Jams/Jellies', '1389', 'BECKY''S BERRIES JAMS/JELLIES', 'seeded from Jill''s CMC invoices (1 day)'),
  ('Y4S194VAPTQW0', 'BEEF BACON', '1201', 'BEEF BACON', 'seeded from Jill''s CMC invoices (2 days)'),
  ('TC1ETRBPF25E4', 'BEEF BONELESS RIBEYE STEAK', '1123', 'BEEF RIBEYE STEAK', 'seeded from Jill''s CMC invoices (9 days)'),
  ('86MXYNT2F8DZR', 'BEEF CHUCK ROAST', '1131', 'BEEF CHUCK ROAST', 'seeded from Jill''s CMC invoices (4 days)'),
  ('M66994YMK2CJT', 'BEEF FAT', '315', 'BEEF FAT', 'seeded from Jill''s CMC invoices (2 days)'),
  ('PVT42SABY4EJ4', 'Beef Fat - Cody', '315', 'BEEF FAT', 'seeded from Jill''s CMC invoices (4 days)'),
  ('WKNTRYWG0T64W', 'BEEF FLAT IRON STEAK', '1129', 'BEEF FLAT IRON STEAK', 'seeded from Jill''s CMC invoices (3 days)'),
  ('DAMA5W6W0PDQC', 'BEEF JERKY', '1373', 'BEEF JERKY', 'seeded from Jill''s CMC invoices (22 days)'),
  ('H79N5C8NHYS14', 'BEEF KNUCKLE BONES', '1238', 'KNUCKLE BONES', 'seeded from Jill''s CMC invoices (3 days)'),
  ('4T10DJVXNK4KE', 'BEEF LIVER', '293', 'BEEF LIVER', 'seeded from Jill''s CMC invoices (3 days)'),
  ('QSDAT0ZF9KZTP', 'BEEF MARROW BONES', '1239', 'MARROW BONES', 'seeded from Jill''s CMC invoices (4 days)'),
  ('7CTFXTX39P0R0', 'BEEF OXTAIL', '1233', 'BEEF OXTAIL', 'seeded from Jill''s CMC invoices (2 days)'),
  ('NNW4G9GZRQR92', 'BEEF RIB BONES', '1237', 'RIB BONES', 'seeded from Jill''s CMC invoices (10 days)'),
  ('ZK2DMZJD4GJN4', 'BEEF RIBEYES - FRESH', '1123', 'BEEF RIBEYE STEAK', 'seeded from Jill''s CMC invoices (1 day)'),
  ('RWG8WJT35SGAC', 'BEEF SHORT RIBS', '1127', 'BEEF SHORT RIBS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('506F6B61E4D7C', 'BEEF SIRLOIN STEAK', '1120', 'BEEF SIRLOIN STEAK', 'seeded from Jill''s CMC invoices (4 days)'),
  ('R8ZMRCBJMYE9T', 'BEEF SIRLOIN TIP STEAKS', '1267', 'BEEF SIR TIP STEAK', 'seeded from Jill''s CMC invoices (5 days)'),
  ('DNQY1HB7SMY3G', 'BEEF SKIRT STEAK', '1168', 'BEEF SKIRT STEAK', 'seeded from Jill''s CMC invoices (2 days)'),
  ('52ZYZ74SXP412', 'Beef Snack Sicks-Ends And Pieces', '1362', 'BEEF STICK ENDS & PIECES', 'seeded from Jill''s CMC invoices (13 days)'),
  ('MCWK4Y0NBT6AR', 'BEEF SNACK STICKS', '1376', 'SNACK STICKS', 'seeded from Jill''s CMC invoices (20 days)'),
  ('FVT164J67Z2AP', 'BEEF SOUP BONES', '1191', 'BEEF SOUP BONES', 'seeded from Jill''s CMC invoices (2 days)'),
  ('K9C75X3P2Y1M8', 'BEEF STEW MEAT', '1100', 'BEEF STEW MEAT', 'seeded from Jill''s CMC invoices (2 days)'),
  ('RGWR0TPFMWBKR', 'BEEF T-BONE STEAK', '1099', 'BEEF T-BONE STEAKS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('PXYGYHQDCKMQR', 'BEEF TENDERLOIN ROAST', '1213', 'BEEF TENDERLOIN ROAST', 'seeded from Jill''s CMC invoices (1 day)'),
  ('7J8Z9MMWDRW54', 'BEEF TONGUE', '294', 'BEEF TONGUE', 'seeded from Jill''s CMC invoices (1 day)'),
  ('M7YXGN2STKVP0', 'BEEF TRI TIP ROAST', '1119', 'BEEF TRI-TIP ROAST', 'seeded from Jill''s CMC invoices (3 days)'),
  ('SZHSGZYZDW7QG', 'BONELESS PORK CHOPS', '1056', 'PORK CHOPS BONELESS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('S19M15SASKT62', 'BROTWURST/HOT DOGS', '1374', 'BROTWURST', 'seeded from Jill''s CMC invoices (17 days)'),
  ('KPXM0YT2Y34NR', 'CHUCK STEAK', '1109', 'BEEF CHUCK STEAK', 'seeded from Jill''s CMC invoices (4 days)'),
  ('P020FABQBFCZP', 'CMC TUMBLER', '1322', 'CMC 16 OZ. CERAMIC MUGS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('7EWKHV2AJ2QX8', 'CUBED STEAK', '1106', 'BEEF CUBED STEAK', 'seeded from Jill''s CMC invoices (6 days)'),
  ('B0E8XM1ZC43WA', 'FILET MIGNON STEAK', '1124', 'BEEF FILET MIGNON STEAK', 'seeded from Jill''s CMC invoices (5 days)'),
  ('MMY389ETWN7DM', 'FLANK STEAK', '1122', 'BEEF FLANK STEAK', 'seeded from Jill''s CMC invoices (2 days)'),
  ('YDEWPN8HH92W6', 'FLANKEN STYLE RIBS', '1199', 'BEEF FLANKEN STYLE RIBS', 'seeded from Jill''s CMC invoices (2 days)'),
  ('ASSRE9M0TYER8', 'Freeze Dried Pet Treats', '1379', 'FREEZE DRIED PET TREATS', 'seeded from Jill''s CMC invoices (3 days)'),
  ('CY23TC7FGS2RE', 'GROUND BEEF PATTIES', '657', 'GROUND BEEF PATTIES', 'seeded from Jill''s CMC invoices (4 days)'),
  ('Q2F53E09MY2T2', 'GROUND PORK', '1240', 'PORK GROUND', 'seeded from Jill''s CMC invoices (1 day)'),
  ('PVNYE74GFY7C0', 'Huckleberry Habanero Jam', '1387', 'KEY TO THE MOUNTAIN PRODUCTS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('DEBG9C1JSGBQC', 'LAMB CHOPS', '1132', 'LAMB CHOPS', 'seeded from Jill''s CMC invoices (2 days)'),
  ('R09T54J9GBR08', 'LAMB SHOULDER STEAK', '1135', 'LAMB SHOULDER STEAK', 'seeded from Jill''s CMC invoices (2 days)'),
  ('KVJDDP3RWKYTR', 'LAMB STEW MEAT', '549', 'LAMB STEW MEAT', 'seeded from Jill''s CMC invoices (1 day)'),
  ('N3KJCWEM0BJZJ', 'NEW YORK STEAK', '1126', 'BEEF NEW YORK STRIP STEAK', 'seeded from Jill''s CMC invoices (6 days)'),
  ('5B3D647E0797G', 'Pet Food', '1171', 'PET FOOD', 'seeded from Jill''s CMC invoices (4 days)'),
  ('M8VY5AJMEAWB4', 'PHILLY MEAT', '1108', 'BEEF PHILLY MEAT', 'seeded from Jill''s CMC invoices (3 days)'),
  ('E0HDNCKFE0T1Y', 'PORK CHOPS', '1141', 'PORK CHOPS', 'seeded from Jill''s CMC invoices (6 days)'),
  ('FFT7WV1P0KX5C', 'PORK COUNTRY STYLE RIBS', '1152', 'PORK COUNTRY STYLE RIBS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('PH69RFDZA5ZM8', 'PORK FAT', '316', 'PORK FAT', 'seeded from Jill''s CMC invoices (1 day)'),
  ('8S1KKCBWT0FC0', 'PORK FRESH SIDE', '1142', 'PORK FRESH SIDE', 'seeded from Jill''s CMC invoices (5 days)'),
  ('G42Z5YEDXRYTT', 'PORK HONEY BACON', '1150', 'PORK HONEY BACON', 'seeded from Jill''s CMC invoices (12 days)'),
  ('91HRSG1SMVY6Y', 'PORK ITALIAN SAUSAGE', '1144', 'PORK ITALIAN SAUSAGE', 'seeded from Jill''s CMC invoices (4 days)'),
  ('RVHAQ7F9VHFX4', 'PORK JUMPSTART SAUSAGE', '1211', 'PORK JUMPSTART SAUSAGE', 'seeded from Jill''s CMC invoices (3 days)'),
  ('GC78Q21BVHBHC', 'PORK SAUSAGE', '1164', 'PORK SAUSAGE', 'seeded from Jill''s CMC invoices (9 days)'),
  ('5VWNCZCPXK8XR', 'PORK SHOULDER BACON', '1187', 'PORK SHOULDER BACON', 'seeded from Jill''s CMC invoices (1 day)'),
  ('4GCBYCM0368HT', 'PORK SHOULDER ROAST', '413', 'PORK SHOULDER BONELESS', 'seeded from Jill''s CMC invoices (4 days)'),
  ('G78241H51X448', 'PORK SHOULDER STEAK', '1001', 'PORK SHOULDER STEAK', 'seeded from Jill''s CMC invoices (1 day)'),
  ('JYB4AXPW4DJ4C', 'PORK SPARE RIBS', '1146', 'PORK SPARE RIBS', 'seeded from Jill''s CMC invoices (1 day)'),
  ('95HA17T8H8EWT', 'PORK TRIM', '90', 'PORK TRIM', 'seeded from Jill''s CMC invoices (1 day)'),
  ('E3GWCMRA3BH2T', 'PORTERHOUSE STEAK', '1125', 'BEEF PORTERHOUSE STEAK', 'seeded from Jill''s CMC invoices (3 days)'),
  ('X92NHCD7B56HY', 'Red Shrimp', '759', 'RED SHRIMP 16/20', 'seeded from Jill''s CMC invoices (2 days)'),
  ('BKJ8W8W5H3M4W', 'Seasoned Chuck Roast', '1236', 'BEEF CHUCK ROAST SEASONED', 'seeded from Jill''s CMC invoices (3 days)'),
  ('HSM3ZYBFM4REP', 'SLICED SUMMER SAUSAGE/SALAMI', '1377', 'BEEF SUMMER SAUSAGE/SALAMI', 'seeded from Jill''s CMC invoices (1 day)'),
  ('V653T2JPDBQ54', 'Smoked Beef Rib Bones', '284', 'SMOKED DOG BONE', 'seeded from Jill''s CMC invoices (3 days)'),
  ('ZBMZRNW5FZQ18', 'Smoked Cheese', '328', 'SMOKED CHEESE', 'seeded from Jill''s CMC invoices (3 days)'),
  ('M3TR3JWFT712E', 'SMOKED PORK CHOPS', '1154', 'PORK CHOPS SMOKED', 'seeded from Jill''s CMC invoices (5 days)'),
  ('1P1MS3HDKTKQR', 'WHOLE SUMMER SAUSAGE/SALAMI', '1398', 'WHOLE SUMMER SAUSAGE/SALAMI', 'seeded from Jill''s CMC invoices (16 days)')
on conflict (clover_item_id) do nothing;

-- Clover card deposits (the bank side of each day's card sales). One row per
-- shop day: Clover pays each day's card batch out as one deposit, less the 25%
-- loan holdback and fees — see lib/qboDeposits.ts. business_date is the SALES
-- day, so a batch can't be deposited twice.
create table if not exists public.clover_card_deposits (
  business_date   date primary key,
  status          text not null check (status in ('posting', 'posted', 'error')),
  bank_date       date not null,
  gross_cents     bigint not null,       -- card payments − card refunds
  holdback_cents  bigint not null,       -- Clover Loan Payable
  fee_cents       bigint not null,       -- Clover POS Processing Fee
  deposit_cents   bigint not null,       -- what the bank received
  items           jsonb not null,        -- the Undeposited Funds entries pulled in
  qbo_deposit_id  text,
  approved_by     text,
  posted_at       timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
alter table public.clover_card_deposits enable row level security;
