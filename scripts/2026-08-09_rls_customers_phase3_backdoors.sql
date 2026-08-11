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

-- APPLIED 2026-08-10, with two corrections found while running it. Both are
-- folded in below; the file as written first time did NOT close these.
--
-- CORRECTION 1 — revoking from `anon` alone was a no-op on the functions.
--   All three carried the Postgres default grant of EXECUTE to PUBLIC, which
--   anon inherits, so after the original script ran customer_cut_sheet_counts()
--   still answered an anonymous request with a row per customer. Verified live.
--   Phase 1 avoided this by revoking `from public, anon` — these need the same.
--   Symptom to watch for: `\df+` / pg_proc.proacl showing a leading `=X/...`
--   entry, which is the PUBLIC grant.
--
-- CORRECTION 2 — a FOURTH door nobody had listed.
--   cutting_instruction_contact_links is another postgres-owned view over
--   `customers`, and anon held explicit full grants on it. It returns only
--   (cutting_instruction_id, customer_id) rather than names or contacts, but
--   that is still an enumeration of customer ids. It is read INTERNALLY by
--   customer_cut_sheet_counts() and customer_cut_sheets(), which are SECURITY
--   INVOKER, so `authenticated` must keep SELECT or the portal's cut sheet
--   pages break.
--
-- Both views also carried INSERT/UPDATE/DELETE grants. Neither is auto-updatable
-- (information_schema.views.is_updatable = NO), so those were inert rather than
-- an escalation path, but they are narrowed to SELECT to match the intent.

begin;

revoke all on public.v_producer_customer_ties from anon;
revoke all on public.v_producer_customer_ties from authenticated;
grant select on public.v_producer_customer_ties to authenticated;

revoke all on public.cutting_instruction_contact_links from anon;
revoke all on public.cutting_instruction_contact_links from authenticated;
grant select on public.cutting_instruction_contact_links to authenticated;

-- `from public, anon` — see CORRECTION 1. Revoking from anon alone does nothing.
revoke execute on function public.customer_cut_sheet_counts()            from public, anon;
revoke execute on function public.customer_cut_sheets(uuid)              from public, anon;
revoke execute on function public.customer_animals_via_cut_sheets(uuid)  from public, anon;

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
-- grant select on public.cutting_instruction_contact_links to anon;
-- grant execute on function public.customer_cut_sheet_counts()            to anon;
-- grant execute on function public.customer_cut_sheets(uuid)              to anon;
-- grant execute on function public.customer_animals_via_cut_sheets(uuid)  to anon;
-- commit;
