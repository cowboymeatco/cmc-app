-- Delivery: Baker Storage destination + tie-in to processing sessions
--
-- 1. id had no default (NOT NULL text) — every POST /api/delivery has been
--    failing the not-null check since the default was dropped, which is why
--    nothing has been logged since April. Restore the 8-char hex style the
--    existing rows use.
-- 2. destination — where the run went. 'customer' = to the customer's hands,
--    'baker_storage' = hauled to the locker in Baker (still ours, still
--    accruing the monthly storage fee).
-- 3. session_refs — which processing sessions rode along, so a run can cover
--    several customers and we can flip their scanner status on save.

alter table delivery_scans
  alter column id set default upper(substr(md5(gen_random_uuid()::text), 1, 8));

alter table delivery_scans
  add column if not exists destination text not null default 'customer';

alter table delivery_scans
  add column if not exists session_refs jsonb not null default '[]'::jsonb;

comment on column delivery_scans.destination is
  'customer | baker_storage — where this run dropped the product';
comment on column delivery_scans.session_refs is
  'array of {customer_name, session_date} identifying the processing sessions on this run';
