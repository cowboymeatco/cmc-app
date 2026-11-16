-- Fresh or frozen per line on a retail order.
--
-- Charlie, 2026-11-12 (/orders feedback): "I need to be able to edit more
-- fields on retail orders. The hysham student council needs fresh not frozen
-- ground beef." 2026-11-16: condition has to be settable per item, not only
-- for the whole order.
--
-- retail_orders.fresh_or_frozen stays the order's default. A line with NULL
-- here follows the order; 'fresh' or 'frozen' overrides it for that line only.
-- Every existing line is NULL, so nothing reads differently after this runs.
--
-- NOT APPLIED. Waiting on Charlie's go-ahead.

alter table public.retail_order_items
  add column if not exists fresh_or_frozen text
  check (fresh_or_frozen is null or fresh_or_frozen in ('fresh', 'frozen'));

comment on column public.retail_order_items.fresh_or_frozen is
  'NULL = follow retail_orders.fresh_or_frozen; otherwise this line''s own condition.';
