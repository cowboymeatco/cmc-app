-- ─────────────────────────────────────────────────────────────────────────────
-- RLS lockdown 1a of 3 — back-office logs and QuickBooks caches.
--
-- NOT YET APPLIED.  Run only after the cmc-app commit that moves every route
-- touching these tables onto supabaseAdmin (service role) is live in production.
--
-- Same posture as qbo_tokens / exec_sessions / tk_*: RLS on, no policies, so
-- anon and authenticated get nothing and only the service role reads or writes.
-- Grants are revoked too (RLS does not stop TRUNCATE).
--
-- Who touches these (checked 2026-09-29, code sweep + 24h of API logs):
--   cmc-app API routes only, now on the service role.  Nothing in the portal,
--   the cutting form or any device agent.  scripts/qbo/import-items.mjs now
--   uses SUPABASE_SERVICE_ROLE_KEY.
--
-- Check after: /billing, /qbo (links, push, customer match), /alignment,
-- /clover (links, push, reconcile), processing records, feedback admin.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'billable_events',
    'clover_push_log',
    'clover_ringup_sweep_log',
    'qbo_customers',
    'qbo_items',
    'qbo_push_log',
    'processing_records',
    'feedback_archive_2026_07_11'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Trigger-only SECURITY DEFINER functions.  Postgres checks EXECUTE on a
-- trigger function when the trigger is created, not when it fires, so this
-- does not affect the triggers; it only removes the /rest/v1/rpc/<name> door.
revoke execute on function public.log_order_event()            from public, anon, authenticated;
revoke execute on function public.notify_cutting_instruction() from public, anon, authenticated;
revoke execute on function public.sync_cut_sheet_appointment() from public, anon, authenticated;
revoke execute on function public.sync_portal_order_status()   from public, anon, authenticated;
revoke execute on function public.sync_product_from_plu()      from public, anon, authenticated;
-- Called only by the weekly-product-weight-refresh cron job (runs as postgres).
revoke execute on function public.refresh_product_weights_and_cases() from public, anon, authenticated;

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- do $$ declare t text; begin
--   foreach t in array array['billable_events','clover_push_log','clover_ringup_sweep_log',
--     'qbo_customers','qbo_items','qbo_push_log','processing_records','feedback_archive_2026_07_11'] loop
--     execute format('alter table public.%I disable row level security', t);
--     execute format('grant all on public.%I to anon, authenticated', t);
--   end loop; end $$;
-- grant execute on function public.log_order_event(), public.notify_cutting_instruction(),
--   public.sync_cut_sheet_appointment(), public.sync_portal_order_status(),
--   public.sync_product_from_plu(), public.refresh_product_weights_and_cases()
--   to public, anon, authenticated;
-- commit;
