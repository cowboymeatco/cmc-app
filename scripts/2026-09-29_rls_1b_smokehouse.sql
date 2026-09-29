-- ─────────────────────────────────────────────────────────────────────────────
-- RLS lockdown 1b of 3 — smokehouse and cook logging.
--
-- NOT YET APPLIED.  Run after the cmc-app service-role commit is live, and NOT
-- while a smokehouse cook is running: the shop PC writes readings every few
-- minutes.
--
-- Writers seen in 24h of API logs (2026-09-29): smokehouse_reading,
-- smokehouse_cook, cook_reading and cook_session are written by the shop PC
-- (python-requests) with the service_role key, and thermoworks-sync / the
-- smokehouse alarm importer use SUPABASE_SERVICE_ROLE_KEY.  Service role
-- bypasses RLS, so they keep working.  Everything else is cmc-app, now on
-- supabaseAdmin.
--
-- Triggers: smokehouse_cook_auto_profile reads cook_profile as the invoker.
-- Its only writer is the service role, so that is fine.
--
-- The two views are SECURITY DEFINER (they run as postgres and ignore RLS), so
-- anon's grants on them are revoked here too, or they would stay a side door.
--
-- Check after: /smokehouse (cooks, alarms, RH fault), the recipe book, cook
-- profiles, the cure load page, and that a new reading lands within ~5 min.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'cook_profile',
    'cook_reading',
    'cook_session',
    'cook_settings',
    'smokehouse_alarm',
    'smokehouse_cook',
    'smokehouse_reading'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on public.smokehouse_alarm_v    from anon, authenticated;
revoke all on public.smokehouse_rh_fault_v from anon, authenticated;

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- do $$ declare t text; begin
--   foreach t in array array['cook_profile','cook_reading','cook_session','cook_settings',
--     'smokehouse_alarm','smokehouse_cook','smokehouse_reading'] loop
--     execute format('alter table public.%I disable row level security', t);
--     execute format('grant all on public.%I to anon, authenticated', t);
--   end loop; end $$;
-- grant all on public.smokehouse_alarm_v, public.smokehouse_rh_fault_v to anon, authenticated;
-- commit;
