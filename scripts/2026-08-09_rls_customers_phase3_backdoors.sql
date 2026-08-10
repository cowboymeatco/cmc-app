-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3 of 3 — close the ways round phases 1–2.  OPTIONAL BUT RECOMMENDED.
--
-- Phases 1–2 put `customers` behind RLS.  They do not, on their own, stop the
-- anon key reading the same names and ids through a view and three functions:
--
--   v_producer_customer_ties     485 rows, includes customer_name, customer_id,
--                                producer, and the whole carcass/weight picture.
--                                A VIEW reads its base tables with the VIEW
--                                OWNER's rights, so RLS on `customers` never
--                                gets consulted. Verified anon-readable.
--   customer_cut_sheet_counts()  takes no arguments and hands back a row per
--                                customer — an enumeration of every customer id.
--   customer_cut_sheets(uuid)    cut sheets for any customer id you hold.
--   customer_animals_via_cut_sheets(uuid)   likewise, for animals.
--
-- All four answered an anonymous request on 2026-08-09.
--
-- RUN AFTER the app changes are deployed. Consumers were traced first; after
-- those changes every remaining caller is either the service role or a
-- signed-in user:
--   v_producer_customer_ties        → cmc-app /api/reports  (service role)
--   customer_cut_sheets             → cmc-app /api/customers (service role)
--                                     portal lib/cutSheets   (authenticated)
--   customer_cut_sheet_counts       → cmc-app /api/customers (service role)
--   customer_animals_via_cut_sheets → portal dashboard, /animals/[id]
--                                     (authenticated)
-- Nothing left calls them as anon.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

revoke all on public.v_producer_customer_ties from anon;
grant select on public.v_producer_customer_ties to authenticated;

revoke execute on function public.customer_cut_sheet_counts()            from anon;
revoke execute on function public.customer_cut_sheets(uuid)              from anon;
revoke execute on function public.customer_animals_via_cut_sheets(uuid)  from anon;

grant execute on function public.customer_cut_sheet_counts()             to authenticated;
grant execute on function public.customer_cut_sheets(uuid)               to authenticated;
grant execute on function public.customer_animals_via_cut_sheets(uuid)   to authenticated;

commit;

-- If a signature below does not match, list the real ones first and adjust:
--   select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('customer_cut_sheets','customer_cut_sheet_counts',
--                        'customer_animals_via_cut_sheets');

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- grant select on public.v_producer_customer_ties to anon;
-- grant execute on function public.customer_cut_sheet_counts()            to anon;
-- grant execute on function public.customer_cut_sheets(uuid)              to anon;
-- grant execute on function public.customer_animals_via_cut_sheets(uuid)  to anon;
-- commit;
