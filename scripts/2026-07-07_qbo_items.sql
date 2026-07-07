-- QuickBooks Online integration (2026-07-07)
-- Applied to prod via Supabase MCP 2026-07-07.
--
-- plu_items.quickbooks_item_id mirrors clover_item_id semantics: '' = unlinked,
-- otherwise the QBO item Id (e.g. '84'). Links are name-suggested, human-confirmed
-- in the /processing QuickBooks tab — same pattern as Clover.
--
-- qbo_items is a cached snapshot of the QBO "Products & Services" list. The app
-- has no QBO OAuth yet, so it reads this cache instead of calling QBO directly.
-- Refresh: re-export from QuickBooks (via Claude session) and run
--   node --env-file=.env.local scripts/qbo/import-items.mjs <items.json>

alter table plu_items add column if not exists quickbooks_item_id text not null default '';

create table if not exists qbo_items (
  id uuid primary key default gen_random_uuid(),
  qbo_id text unique,                    -- QuickBooks internal item Id (null until resolved)
  full_name text not null,               -- fully qualified, e.g. 'RETAIL SALES:RETAIL CUTS:Beef Trim'
  name text not null,                    -- leaf segment of full_name
  type text,                             -- SERVICE / ITEM_INVENTORY / NONINVENTORY / BUNDLE
  description text,
  sales_price numeric,
  purchase_price numeric,
  qty_on_hand numeric,
  taxable boolean,
  active boolean not null default true,  -- false = "(deleted)" in QBO
  synced_at timestamptz not null default now()
);
create index if not exists qbo_items_active_idx on qbo_items (active);
create index if not exists qbo_items_name_idx on qbo_items (name);
