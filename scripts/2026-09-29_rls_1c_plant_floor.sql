-- ─────────────────────────────────────────────────────────────────────────────
-- RLS lockdown 1c of 3 — plant floor: boxes, scans, receiving, chill, cure,
-- carcass assignments, value add.
--
-- NOT YET APPLIED.  The busiest tables in the app (box_scans gets hundreds of
-- writes a shift), so run after close of business Mountain Time, with the
-- cmc-app service-role commit already live.
--
-- Who touches these (checked 2026-09-29, code sweep + 24h of API logs): only
-- cmc-app's API routes, now on supabaseAdmin.  Nothing in the portal, cutting
-- form or device agents.
--
-- Triggers: trg_boxes_autolink_carcass (boxes) reads carcass_assignments as
-- the invoker; its writers are all service role now.
--
-- The SECURITY DEFINER views over these tables are revoked from anon /
-- authenticated too.  cmc-app reads v_box_session_stats, v_freezer_orders,
-- v_producer_customer_ties and v_used_plu_numbers through supabaseAdmin;
-- nothing outside cmc-app reads any of them.
--
-- Check after: scanner (scan a box, merge, unpack, reassign), box labels,
-- receiving, harvest/chill entry, cure tags + cure load, carcass assignment,
-- delivery loadout/pull/packing slip, value add (box link, box weight, label),
-- yield, inventory count lines, calendar, reports.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'box_receiving_log',
    'box_scans',
    'boxes',
    'carcass_assignments',
    'chill_log',
    'cure_tags',
    'value_add_job_box',
    'value_add_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on public.v_box_session_stats      from anon, authenticated;
revoke all on public.v_freezer_orders         from anon, authenticated;
revoke all on public.v_carcass_boxed_yield    from anon, authenticated;
revoke all on public.v_producer_customer_ties from anon, authenticated;
revoke all on public.v_used_plu_numbers       from anon, authenticated;

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- do $$ declare t text; begin
--   foreach t in array array['box_receiving_log','box_scans','boxes','carcass_assignments',
--     'chill_log','cure_tags','value_add_job_box','value_add_jobs'] loop
--     execute format('alter table public.%I disable row level security', t);
--     execute format('grant all on public.%I to anon, authenticated', t);
--   end loop; end $$;
-- grant all on public.v_box_session_stats, public.v_freezer_orders, public.v_carcass_boxed_yield,
--   public.v_producer_customer_ties, public.v_used_plu_numbers to anon, authenticated;
-- commit;
