-- Which Pico wedges are alive (Charlie, 2026-10-22).
--
-- Two boards are on scales now and the only way to know one is running has
-- been its LED, or sending it something and watching the row. Each wedge
-- checks in with /api/scale-callup/device about once a second; that route
-- now stamps the time here. "Online" is a last_seen_at within the last few
-- seconds (lib/scaleCallup.ts WEDGE_ONLINE_SECONDS). Service role only, like
-- scale_callup_requests.

create table if not exists public.scale_wedges (
  scale          text primary key,            -- the crew's number: 1, 2, 3
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  check_ins      bigint not null default 0
);
alter table public.scale_wedges enable row level security;
