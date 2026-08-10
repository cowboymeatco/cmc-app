-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 of 2 — enable RLS and drop the anon grants.  THIS ONE BITES.
--
-- DO NOT RUN until BOTH are true:
--   1. Phase 1 has run (the functions below are referenced by the policies).
--   2. The app changes are DEPLOYED — cmc-app's customer routes on the service
--      role, and the portal's profile-setup / splits paths on the phase 1 RPCs.
--      Running this against the current production code WILL break both apps.
--
-- Rollback is at the bottom of this file.
--
-- WHAT THIS CLOSES
-- `customers` and `producer_qbo_links` had RLS off with full CRUD granted to
-- `anon`.  NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the portal's browser bundle,
-- so anyone who read that bundle could select, insert, update and delete all
-- 327 customer rows straight against the REST API, with no login.  Verified
-- against production on 2026-08-09.
--
-- WHAT THIS DOES NOT CLOSE
-- cmc-app serves /api/customers publicly with no authentication of any kind
-- (verified: app.cowboymeats.com/api/customers answers 200 to an anonymous
-- request).  That is a second, independent door to the same data and it needs
-- its own fix — see the notes handed over with this migration.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── customers ────────────────────────────────────────────────────────────────
alter table public.customers enable row level security;

drop policy if exists customers_select_own   on public.customers;
drop policy if exists customers_select_staff on public.customers;
drop policy if exists customers_update_own   on public.customers;

-- A signed-in user sees their own row.
create policy customers_select_own on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid());

-- Staff see everyone: /staff/orders lists orders joined to customer name,
-- ranch and phone, and the animal billing card resolves buyers to QuickBooks.
-- is_staff() is SECURITY DEFINER — a policy on customers that read customers
-- directly would recurse.
create policy customers_select_staff on public.customers
  for select to authenticated
  using (public.is_staff());

-- Self-service edits to your own row.  WHICH COLUMNS is enforced by the
-- column-level grant below, not by this policy: without that grant a user
-- could set is_staff = true on their own row and promote themselves to staff.
create policy customers_update_own on public.customers
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- No INSERT or DELETE policy for authenticated on purpose.  The only two paths
-- that create customer rows (profile setup, adding a split buyer) go through
-- the phase 1 SECURITY DEFINER functions, which check the caller first.
-- Deletion is staff-only and happens in cmc-app on the service role.

revoke all on public.customers from anon;
revoke all on public.customers from authenticated;

grant select on public.customers to authenticated;
-- Deliberately excludes is_staff, is_wholesale, wholesale_discount_pct, role,
-- qbo_customer_id, auth_user_id and email.  is_staff is the privilege flag;
-- auth_user_id and email are how a row is claimed at profile setup.
grant update (name, ranch_name, phone, preferred_contact, notes)
  on public.customers to authenticated;


-- ── producer_qbo_links ───────────────────────────────────────────────────────
-- Only a producer-name → QuickBooks-id map, so the exposure is smaller, but it
-- was equally anon-writable and a bad row here silently misdirects billing.
-- Read by the portal only inside the staff-gated animal billing card; cmc-app
-- writes it on the service role.
alter table public.producer_qbo_links enable row level security;

drop policy if exists producer_qbo_links_select_staff on public.producer_qbo_links;

create policy producer_qbo_links_select_staff on public.producer_qbo_links
  for select to authenticated
  using (public.is_staff());

revoke all on public.producer_qbo_links from anon;
revoke all on public.producer_qbo_links from authenticated;
grant select on public.producer_qbo_links to authenticated;

commit;


-- ── Verify (expect: relrowsecurity = true, and no anon rows) ─────────────────
-- select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--  where c.relname in ('customers','producer_qbo_links');
--
-- select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public'
--    and table_name in ('customers','producer_qbo_links')
--    and grantee in ('anon','authenticated')
--  order by grantee, table_name, privilege_type;
--
-- select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy where polrelid = 'public.customers'::regclass;


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Restores the previous (insecure) state exactly.  Only for a live incident
-- where the portal is down and there is no time to fix forward.
--
-- begin;
-- alter table public.customers            disable row level security;
-- alter table public.producer_qbo_links   disable row level security;
-- drop policy if exists customers_select_own            on public.customers;
-- drop policy if exists customers_select_staff          on public.customers;
-- drop policy if exists customers_update_own            on public.customers;
-- drop policy if exists producer_qbo_links_select_staff on public.producer_qbo_links;
-- grant all on public.customers          to anon, authenticated;
-- grant all on public.producer_qbo_links to anon, authenticated;
-- commit;
