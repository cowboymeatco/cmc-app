-- QuickBooks push audit log (2026-07-11)
-- Applied to prod via Supabase MCP 2026-07-11.
-- Every app -> QuickBooks write (price sync, ALL CAPS rename) gets a row,
-- mirroring clover_push_log. plu_id is null for catalog-wide sweep renames.
create table if not exists qbo_push_log (
  id uuid primary key default gen_random_uuid(),
  plu_id uuid,
  plu_number text,
  item_name text,
  qbo_item_id text not null,
  field text not null,          -- 'price' | 'name'
  old_value text,
  new_value text,
  status text not null,         -- 'ok' | 'error'
  error text,
  created_at timestamptz not null default now()
);
create index if not exists qbo_push_log_created_idx on qbo_push_log (created_at desc);
