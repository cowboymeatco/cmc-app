-- One round trip per wedge poll (Charlie, 2026-11-10).
--
-- Each Pico polls /api/scale-callup/device about once a second, and that
-- route was making four Supabase calls per poll: read check_ins, write the
-- heartbeat, expire stale call-ups, look for the next job. Three boards made
-- that ~630,000 requests a day for a handful of real call-ups a week. At
-- ~1.3 KB of HTTP headers each that was 98% of the org's egress and what
-- tripped the free-tier quota on 2026-11-08 (every request answered 402 for
-- 18 hours). This function does all four steps in one statement, so the
-- route makes one call.
--
-- scanner_seen_at: when a /scanner or /scale-callup page last had this scale
-- on screen. The device route hands a wedge a longer wait when nobody is
-- working its station (lib/scaleCallup.ts wedgePollSeconds) and the firmware
-- honors it, so the boards go quiet nights and Sundays.
--
-- Run in the Supabase SQL editor (or: applied through the MCP on 2026-11-10).

alter table public.scale_wedges
  add column if not exists scanner_seen_at timestamptz;

create or replace function public.wedge_check_in(
  p_scale        text,
  p_done_id      uuid    default null,
  p_done_ok      boolean default null,
  p_done_error   text    default null,
  p_ttl_seconds  integer default 90
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_seen timestamptz;
  v_job  jsonb;
begin
  -- 0. Heartbeat: this wedge is alive and answering to this scale number.
  insert into scale_wedges (scale, first_seen_at, last_seen_at, check_ins)
  values (p_scale, v_now, v_now, 1)
  on conflict (scale) do update
    set last_seen_at = excluded.last_seen_at,
        check_ins    = scale_wedges.check_ins + 1
  returning scanner_seen_at into v_seen;

  -- 1. How the last one went. Only a row this wedge claimed can be closed.
  if p_done_id is not null then
    update scale_callup_requests
       set status       = case when p_done_ok then 'done' else 'error' end,
           completed_at = v_now,
           error        = case when p_done_ok then null
                               else left(coalesce(p_done_error, 'wedge reported failure'), 200) end
     where id = p_done_id and scale = p_scale and status = 'claimed';
  end if;

  -- 2. Anything that sat unclaimed past its time is stale, not a job: the
  --    packer has moved on and the scale may have a different cut on it.
  update scale_callup_requests
     set status       = 'expired',
         completed_at = v_now,
         error        = format('nothing typed it within %ss', p_ttl_seconds)
   where scale = p_scale
     and status = 'pending'
     and created_at < v_now - make_interval(secs => p_ttl_seconds);

  -- 3. Claim the oldest one still waiting for this scale. The row lock means
  --    two polls can never hand out the same job.
  update scale_callup_requests r
     set status = 'claimed', claimed_at = v_now
   where r.id = (
     select id from scale_callup_requests
      where scale = p_scale and status = 'pending'
      order by created_at
      limit 1
      for update skip locked
   )
  returning jsonb_build_object('id', r.id, 'plu', r.plu, 'keys', r.keys, 'item_name', r.item_name)
    into v_job;

  return jsonb_build_object('job', v_job, 'scanner_seen_at', v_seen);
end
$$;

-- Service role only, like the tables it touches. PostgREST exposes every
-- function in public to the anon key unless told otherwise.
revoke all on function public.wedge_check_in(text, uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.wedge_check_in(text, uuid, boolean, text, integer) to service_role;
