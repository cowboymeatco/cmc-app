-- Schedule thermoworks-sync every 30 minutes.
--
-- Run this ONLY after the function has been deployed and test-invoked
-- successfully, and disable the Windows scheduled task at the same time —
-- otherwise both write readings and you get duplicate rows.
--
-- Replace <PROJECT_REF> with the project ref before running.

-- One-time prerequisites (no-ops if already enabled):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service role key in Vault so it isn't sitting in the cron job body.
-- Run once, substituting the real key:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

select cron.schedule(
  'thermoworks-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/thermoworks-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- ── Handy ────────────────────────────────────────────────────────────────────
-- See the schedule:
--   select jobid, jobname, schedule, active from cron.job;
--
-- See recent runs and whether they succeeded:
--   select runid, status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'thermoworks-sync')
--   order by start_time desc limit 20;
--
-- Confirm readings are actually landing:
--   select read_at, channel_label, temp_f from cook_reading
--   order by read_at desc limit 10;
--
-- Turn it off:
--   select cron.unschedule('thermoworks-sync');
