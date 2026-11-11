-- ─────────────────────────────────────────────────────────────────────────────
-- Invoicing — price book, customer prices, invoice/payment log, booking flags.
-- See docs/invoicing-spec.md (signed off by Charlie 2026-11-11).
--
-- NOT YET APPLIED. Charlie approves this file before it runs.
--
-- Additive only: four new tables, new columns with defaults, one backfill.
-- Nothing existing is dropped, renamed or rewritten, so the live app keeps
-- working before and after the code that uses it ships.
--
-- New tables get the back-office posture (RLS on, no policies, anon and
-- authenticated revoked): only the app's server routes (service role) touch
-- them. billable_events itself is left as it is — it's already in the pending
-- RLS lockdown 1a (scripts/2026-09-29_rls_1a_back_office.sql).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Price book: the master list every invoice, QBO, Clover and the website
--       follow. One row per chargeable rate.
create table if not exists public.price_book (
  key             text primary key,                -- stable code name, e.g. 'beef_kill_only'
  label           text not null,                   -- what people read, e.g. 'Beef Kill & Chill Only'
  category        text not null check (category in ('processing','curing','sausage','smokehouse','fee','cmc_animal','wild_game')),
  species         text,                            -- Beef / Hog / Lamb / Goat / null = any
  rate            numeric(10,4) not null check (rate >= 0),
  unit            text not null check (unit in ('lb_hcw','lb_in','lb_out','lb_cured','lb','head','flat','day','month','hour','pkg')),
  qbo_item_id     text,                            -- null until linked / created in QuickBooks
  qbo_item_name   text,                            -- QBO leaf name, for linking
  clover_item_id  text,                            -- only where Clover carries it
  website_section text,                            -- null = not shown on cowboymeats.com
  website_label   text,
  sort_order      integer not null default 0,
  auto            boolean not null default true,   -- false = office adds it by hand (late fee, long hang)
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- Every change to a rate, and where it was pushed.
create table if not exists public.price_book_changes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  key         text not null references public.price_book(key),
  field       text not null,                       -- rate / label / qbo_item_id / active …
  old_value   text,
  new_value   text,
  changed_by  text,
  pushed_qbo     text,                             -- null = not pushed, 'ok', or the error
  pushed_clover  text,
  pushed_website text
);
create index if not exists price_book_changes_key_idx on public.price_book_changes (key, created_at desc);

-- ── 2. Customer prices: a regular producer's deal, applied before the standard
--       rate and shown as such on the invoice preview.
create table if not exists public.customer_prices (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  qbo_customer_id  text not null,
  customer_name    text not null,                  -- display only; matching is on qbo_customer_id
  price_key        text not null references public.price_book(key),
  rate             numeric(10,4) not null check (rate >= 0),
  note             text,
  created_by       text,
  active           boolean not null default true,
  unique (qbo_customer_id, price_key)
);

-- ── 3. Charges: remember what the rate was before the office changed it.
--       (qbo_invoice_id and error already exist.)
alter table public.billable_events
  add column if not exists qbo_doc_number text not null default '',
  add column if not exists original_rate  numeric,
  add column if not exists edited_by      text,
  add column if not exists edit_reason    text,
  add column if not exists price_key      text,          -- which price_book row priced it
  add column if not exists invoice_log_id uuid;

-- ── 4. Invoice / payment log: every post to QuickBooks, with who approved it.
--       request_id is QuickBooks' idempotency key: the same approval can never
--       post twice even if the button is pressed twice or a request retries.
create table if not exists public.invoice_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('invoice','payment','item')),
  status           text not null check (status in ('ok','error')),
  request_id       text not null,
  qbo_id           text,                           -- Invoice / Payment / Item id QuickBooks returned
  doc_number       text,                           -- e.g. 26315-01
  qbo_customer_id  text,
  customer_name    text,
  amount           numeric(12,2),
  source_ref       text,                           -- payments: the Clover payment id
  approved_by      text,
  request          jsonb,
  response         jsonb,
  error            text
);
create unique index if not exists invoice_log_request_ok_uq   on public.invoice_log (request_id) where status = 'ok';
create unique index if not exists invoice_log_doc_ok_uq       on public.invoice_log (doc_number) where kind = 'invoice' and status = 'ok';
create unique index if not exists invoice_log_payment_ok_uq   on public.invoice_log (source_ref) where kind = 'payment' and status = 'ok';
create index        if not exists invoice_log_created_idx     on public.invoice_log (created_at desc);

-- ── 5. Booking flags (set at booking, per Charlie).
alter table public.harvest_appointments
  add column if not exists outdoor_kill boolean not null default false,
  add column if not exists rush         boolean not null default false;

-- ── 6. Baker storage: when the order went to Baker, so the $20 transfer and
--       the $28/month have a start date. Backfill from the last status change
--       for orders already sitting there.
alter table public.processing_sessions
  add column if not exists baker_storage_at timestamptz;
update public.processing_sessions
   set baker_storage_at = coalesce(updated_at, created_at)
 where status = 'baker_storage' and baker_storage_at is null;

-- ── 7. Lock the new tables to the server.
do $$
declare t text;
begin
  foreach t in array array['price_book','price_book_changes','customer_prices','invoice_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── 8. Seed the price book from docs/invoicing-spec.md (rates as of 2026-11-11:
--       QuickBooks, cowboymeats.com and Charlie's answers). Existing rows are
--       left alone, so re-running never overwrites an edited price.
insert into public.price_book (key, label, category, species, rate, unit, qbo_item_id, qbo_item_name, website_section, website_label, sort_order, auto) values
  -- Processing (website shows kill + cut & wrap as one all-in number)
  ('beef_kill',            'Custom Beef Kill',                   'processing','Beef', 0.38,'lb_hcw','1215','CUSTOM BEEF KILL',              null,null, 10,true),
  ('beef_proc_whole_half', 'Custom Processing - Whole, Half',    'processing','Beef', 1.17,'lb_hcw','1214','CUSTOM PROCESSING-WHOLE, HALF', null,null, 11,true),
  ('beef_proc_quarter',    'Custom Processing - Quarters',       'processing','Beef', 1.22,'lb_hcw','1216','CUSTOM PROCESSING-QUARTERS',    null,null, 12,true),
  ('beef_kill_only',       'Beef Kill & Chill Only',             'processing','Beef', 0.53,'lb_hcw', null,'BEEF KILL & CHILL ONLY',        'Processing','Beef Kill & Chill Only', 13,true),
  ('hog_kill',             'Custom Hog Kill',                    'processing','Hog',  0.58,'lb_hcw','1247','CUSTOM HOG KILL',               'Processing','Hog Kill & Chill Only', 20,true),
  ('hog_proc',             'Custom Hog Processing',              'processing','Hog',  1.17,'lb_hcw','138', 'CUSTOM HOG PROCESSING',         null,null, 21,true),
  ('lamb_kill_only',       'Lamb Kill Only',                     'processing','Lamb', 75,  'head',  '1298','LAMB KILL ONLY',                'Processing','Lamb Kill Only', 30,true),
  ('lamb_proc',            'Custom Lamb/Sheep Flat Fee',         'processing','Lamb', 180, 'head',  '105', 'CUSTOM LAMB/SHEEP FLAT FEE',    'Processing','Lamb and Goat Processing', 31,true),
  ('goat_proc',            'Goat Processing Flat Fee',           'processing','Goat', 180, 'head',  '134', 'GOAT PROCESSING FLAT FEE',      null,null, 32,true),
  -- Curing (cured lb)
  ('hog_curing',           'Custom Hog Curing',                  'curing','Hog',  2.00,'lb_cured',null,'CUSTOM HOG CURING',   'Processing','Custom Hog Curing', 40,true),
  ('beef_bacon_curing',    'Beef Bacon Curing',                  'curing','Beef', 2.50,'lb_cured',null,'BEEF BACON CURING',   'Value-Added Processing','Beef Bacon Curing', 41,true),
  ('beef_curing',          'Corned Beef Curing',                 'curing','Beef', 2.50,'lb_cured',null,'BEEF CURING',         'Value-Added Processing','Corned Beef Curing', 42,true),
  -- Sausage & patties (finished lb out)
  ('beef_sausage',         'Custom Beef Sausage',                'sausage','Beef', 2.00,'lb_out',null,'CUSTOM BEEF SAUSAGE',        'Value-Added Processing','Custom Sausage', 50,true),
  ('pork_sausage',         'Custom Pork Sausage',                'sausage','Hog',  2.00,'lb_out',null,'CUSTOM PORK SAUSAGE',        null,null, 51,true),
  ('pork_sausage_links',   'Custom Pork Sausage Links',          'sausage','Hog',  3.60,'lb_out',null,'CUSTOM PORK SAUSAGE LINKS',  'Value-Added Processing','Custom Pork Sausage Links', 52,true),
  ('lamb_bulk_sausage',    'Custom Lamb Bulk Sausage',           'sausage','Lamb', 1.00,'lb_out',null,'CUSTOM LAMB BULK SAUSAGE',   'Value-Added Processing','Custom Lamb Bulk Sausage', 53,true),
  ('beef_patty_fee',       'Ground Beef Patty Fee',              'sausage','Beef', 1.00,'lb_out',null,'GROUND BEEF PATTY FEE',      'Value-Added Processing','Ground Beef Patties', 54,true),
  ('sausage_patties',      'Sausage Patties',                    'sausage','Hog',  2.50,'lb_out',null,'SAUSAGE PATTIES',            'Value-Added Processing','Sausage Patties', 55,true),
  ('lamb_curry_patties',   'Custom Lamb Curry Patties',          'sausage','Lamb', 2.50,'lb_out',null,'CUSTOM LAMB CURRY PATTIES',  'Value-Added Processing','Lamb Curry Patties', 56,true),
  ('beef_seasoning',       'Custom Beef Seasoning',              'sausage','Beef', 1.00,'lb_out',null,'CUSTOM BEEF SEASONING',      'Value-Added Processing','Custom Beef Seasoning', 57,true),
  ('italian_ground_beef',  'Custom Italian Ground Beef',         'sausage','Beef', 1.00,'lb_out',null,'CUSTOM ITALIAN GROUND BEEF', 'Value-Added Processing','Italian Ground Beef', 58,true),
  -- Smokehouse (raw lb in)
  ('sticks',               'Custom Sticks',                      'smokehouse',null,  4.25,'lb_in',null,'BEEF CUSTOM STICKS',                   'Value-Added Processing','Custom Sticks', 60,true),
  ('sticks_cheese',        'Custom Sticks w/ Cheese',            'smokehouse',null,  5.00,'lb_in',null,'BEEF CUSTOM STICKS W/CHEESE',          'Value-Added Processing','Custom Sticks w/ Cheese', 61,true),
  ('summer',               'Custom Summer / Salami',             'smokehouse',null,  4.25,'lb_in',null,'BEEF CUSTOM SUMMERS/SALAMI',           'Value-Added Processing','Custom Summer / Salami', 62,true),
  ('summer_cheese',        'Custom Summer / Salami w/ Cheese',   'smokehouse',null,  5.00,'lb_in',null,'BEEF CUSTOM SUMMERS/SALAMI W/CHEESE',  'Value-Added Processing','Custom Summer / Salami w/ Cheese', 63,true),
  ('beef_brats',           'Beef Custom Brotwurst',              'smokehouse','Beef',4.25,'lb_in',null,'BEEF CUSTOM BROTWURST',                'Value-Added Processing','Custom Brotwurst', 64,true),
  ('beef_brats_cheese',    'Beef Custom Brotwurst w/ Cheese',    'smokehouse','Beef',5.00,'lb_in',null,'BEEF CUSTOM BROTWURST WITH CHEESE',    'Value-Added Processing','Custom Brotwurst w/ Cheese', 65,true),
  ('pork_brats',           'Pork Custom Brotwurst',              'smokehouse','Hog', 4.25,'lb_in',null,'PORK CUSTOM BROTWURST',                null,null, 66,true),
  ('pork_brats_cheese',    'Pork Custom Brotwurst w/ Cheese',    'smokehouse','Hog', 5.00,'lb_in',null,'PORK CUSTOM BROTWURST WITH CHEESE',    null,null, 67,true),
  ('lamb_brats',           'Lamb Custom Brotwurst',              'smokehouse','Lamb',4.75,'lb_in',null,'LAMB CUSTOM BROTWURST',                'Value-Added Processing','Lamb Brotwurst', 68,true),
  ('lamb_brats_cheese',    'Lamb Custom Brotwurst w/ Cheese',    'smokehouse','Lamb',5.50,'lb_in',null,'LAMB CUSTOM BROTWURST WITH CHEESE',    'Value-Added Processing','Lamb Brotwurst w/ Cheese', 69,true),
  ('hot_dogs',             'Custom Hot Dogs',                    'smokehouse',null,  5.00,'lb_in',null,'BEEF CUSTOM HOT DOGS',                 'Value-Added Processing','Custom Hot Dogs', 70,true),
  ('hot_dogs_cheese',      'Custom Hot Dogs w/ Cheese',          'smokehouse',null,  5.75,'lb_in',null,'BEEF CUSTOM HOT DOGS W/CHEESE',        'Value-Added Processing','Custom Hot Dogs w/ Cheese', 71,true),
  ('beef_jerky',           'Custom Beef Jerky',                  'smokehouse','Beef',11.00,'lb_in',null,'CUSTOM BEEF JERKY',                   'Value-Added Processing','Custom Jerky', 72,true),
  ('pork_jerky',           'Custom Pork Jerky',                  'smokehouse','Hog', 11.00,'lb_in',null,'CUSTOM PORK JERKY',                   null,null, 73,true),
  ('smoking_fee',          'Custom Smoking, Seasoning, Pulling', 'smokehouse',null,  5.00,'lb',   null,'CUSTOM SMOKING FEE',                   'Value-Added Processing','Custom Smoking / Pulling', 74,true),
  -- Fees
  ('philly_slicing',       'Beef Slicing Fee (Philly)',          'fee','Beef', 10, 'flat', null,'BEEF SLICING FEE',                          'Value-Added Processing','Philly Slicing', 80,true),
  ('baker_transfer',       'Baker Transfer & Storage',           'fee',null,   20, 'flat', null,'FULFILLMENT FEE - BAKER TRANSFER & STORAGE','Processing','Baker Storage Transfer', 81,true),
  ('baker_storage',        'Monthly Storage - Baker',            'fee',null,   28, 'month',null,'MONTHLY STORAGE FEE--BAKER STORAGE',        'Processing','Baker Storage (monthly)', 82,true),
  ('outdoor_kill',         'Outdoor Kill Fee',                   'fee',null,   150,'flat', null,'OUTDOOR KILL FEE',                          'Processing','Outdoor Kill', 83,true),
  ('rush',                 'Rush Order Fee',                     'fee',null,   50, 'flat', null,'RUSH ORDER FEE',                            'Processing','Rush Order', 84,true),
  ('extra_long_hang',      'Extra Long Hang (over 14 days)',     'fee','Beef', 5,  'day',  null,'EXTRA LONG HANG',                           'Processing','Extra Long Hang (Over 14 days)', 85,false),
  ('late_fee',             'Late Fee',                           'fee',null,   2,  'flat', null,'LATE FEE',                                  null,null, 86,false),
  -- Our own animals, all-in (meat + kill + processing) on the share's hanging weight
  ('cmc_beef_whole',       'Whole Beef',                         'cmc_animal','Beef', 5.39,'lb_hcw',null,'CMC BEEF','Beef','Whole Beef', 100,true),
  ('cmc_beef_half',        'Half Beef',                          'cmc_animal','Beef', 5.49,'lb_hcw',null,'CMC BEEF','Beef','Half Beef', 101,true),
  ('cmc_beef_quarter',     'Quarter Beef',                       'cmc_animal','Beef', 5.59,'lb_hcw',null,'CMC BEEF','Beef','Quarter Beef', 102,true),
  ('cmc_hog_whole',        'Whole Hog',                          'cmc_animal','Hog',  700, 'head',  null,'CMC HOG', 'Pork','Whole Hog', 103,true),
  ('cmc_hog_half',         'Half Hog',                           'cmc_animal','Hog',  400, 'head',  null,'CMC HOG', 'Pork','Half Hog', 104,true),
  ('cmc_lamb_whole',       'Whole Lamb',                         'cmc_animal','Lamb', 600, 'head',  null,'CMC LAMB','Lamb','Retail Lamb (Whole)', 105,true),
  -- Wild game (website rates)
  ('wg_steaks_off_roasts', 'Steaks off the Roasts',              'wild_game',null, 2.00,'lb',   null,null,                    'Wild Game','Steaks off the Roasts', 200,true),
  ('wg_roasts_whole',      'Roasts Kept Whole & Packaged',       'wild_game',null, 1.50,'lb',   null,null,                    'Wild Game','Roasts Kept Whole & Packaged', 201,true),
  ('wg_jerky',             'Wild Game Jerky',                    'wild_game',null, 11.00,'lb',  null,'WILD GAME JERKY',       'Wild Game','Jerky', 202,true),
  ('wg_grinding',          'Wild Game Grinding',                 'wild_game',null, 1.75,'lb',   null,'WILD GAME GRINDING',    'Wild Game','Ground / Burger', 203,true),
  ('wg_bulk_sausage',      'Wild Game Bulk Sausage',             'wild_game',null, 3.50,'lb',   null,'WILD GAME BULK SAUSAGE','Wild Game','Bulk Sausage', 204,true),
  ('wg_sticks',            'Wild Game Snack Sticks',             'wild_game',null, 4.50,'lb',   null,null,                    'Wild Game','Snack Sticks', 205,true),
  ('wg_sticks_cheese',     'Wild Game Snack Sticks w/ Cheese',   'wild_game',null, 5.25,'lb',   null,null,                    'Wild Game','Snack Sticks with Cheese', 206,true),
  ('wg_summer',            'Wild Game Summer / Salami',          'wild_game',null, 4.50,'lb',   null,'WILD GAME SALAMI/SUMMERS','Wild Game','Summer Sausage / Salami', 207,true),
  ('wg_summer_cheese',     'Wild Game Summer / Salami w/ Cheese','wild_game',null, 5.25,'lb',   null,null,                    'Wild Game','Summer Sausage / Salami with Cheese', 208,true),
  ('wg_brats',             'Wild Game Brotwurst',                'wild_game',null, 4.50,'lb',   null,null,                    'Wild Game','Brotwurst', 209,true),
  ('wg_brats_cheese',      'Wild Game Brotwurst w/ Cheese',      'wild_game',null, 5.25,'lb',   null,'WILD GAME BROTWURST WITH CHEESE','Wild Game','Brotwurst with Cheese', 210,true),
  ('wg_curing',            'Wild Game Curing',                   'wild_game',null, 2.50,'lb',   null,null,                    'Wild Game','Curing', 211,true),
  ('wg_add_pork_trim',     'Add Pork Trim',                      'wild_game',null, 2.79,'lb',   null,null,                    'Wild Game','Add Pork Trim', 212,true),
  ('wg_add_beef_trim',     'Add Beef Trim',                      'wild_game',null, 4.99,'lb',   null,null,                    'Wild Game','Add Beef Trim', 213,true),
  ('wg_add_pork_fat',      'Add Pork Fat',                       'wild_game',null, 1.79,'lb',   null,null,                    'Wild Game','Add Pork Fat', 214,true),
  ('wg_add_beef_fat',      'Add Beef Fat',                       'wild_game',null, 2.59,'lb',   null,'WILD GAME ADD BEEF FAT','Wild Game','Add Beef Fat', 215,true),
  ('wg_cleaning',          'Wild Game Cleaning Fee',             'wild_game',null, 60,  'hour', null,'WILD GAME CLEANING FEE','Wild Game','Cleaning Fee (dirty or hair-on meat)', 216,false),
  ('buffalo_receive',      'Buffalo Receive, Skin & Split',      'wild_game','Buffalo', 85,'head',null,'BUFFALO RECEIVE/SKIN/SPLIT','Wild Game','Buffalo Receive, Skin & Split', 217,true),
  ('buffalo_proc',         'Custom Buffalo Processing',          'wild_game','Buffalo', 1.10,'lb_hcw',null,'CUSTOM BUFFALO PROCESSING','Wild Game','Buffalo Processing', 218,true)
on conflict (key) do nothing;

commit;

-- ── Check after ──────────────────────────────────────────────────────────────
-- select category, count(*) from price_book group by 1 order by 1;   -- 68 rows
-- select count(*) from processing_sessions where baker_storage_at is not null;
-- /billing, /schedule (booking form), scanner still load.

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- begin;
-- drop table if exists public.customer_prices, public.price_book_changes, public.invoice_log;
-- drop table if exists public.price_book;
-- alter table public.billable_events drop column if exists qbo_doc_number, drop column if exists original_rate,
--   drop column if exists edited_by, drop column if exists edit_reason, drop column if exists price_key,
--   drop column if exists invoice_log_id;
-- alter table public.harvest_appointments drop column if exists outdoor_kill, drop column if exists rush;
-- alter table public.processing_sessions drop column if exists baker_storage_at;
-- commit;
