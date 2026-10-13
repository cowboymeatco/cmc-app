-- PLU call-ups for the Pico scale wedges (Charlie, 2026-10-13).
--
-- A Raspberry Pi Pico W on each Hobart's USB port pretends to be the barcode
-- scanner the scale already knows how to listen to: it joins the shop wifi,
-- asks the app for its next job, and types the digits into the scale, Enter
-- at the end, the way a scanner would. The scale calls the product up and the
-- packer weighs. No HCT, no serial, nothing changes on the scale.
--
-- One row here is one "scale 2, call up PLU 118". The app writes it; the Pico
-- on that scale claims it, types it, and reports back. Its own table, for the
-- same reason scale_read_requests is: the kiosk's watcher pushes prices for
-- any scale_push_requests kind it doesn't know.
--
-- The Picos never see Supabase. They talk to /api/scale-callup/device with a
-- bearer token (SCALE_WEDGE_TOKEN in the app's env), and that route uses the
-- service role. So no anon policy is needed for the devices; the app-side
-- route is service-role too.

create table if not exists public.scale_callup_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  requested_by  text,
  -- The crew's number for the scale (1, 2, 3), which is what each Pico is
  -- configured with. The scanner's number→IP map is still being confirmed,
  -- so this deliberately does not carry an IP.
  scale         text not null,
  plu           text not null,
  item_name     text,
  -- What the Pico actually types, Enter at the end: the bare PLU digits, or
  -- the 13-digit in-store barcode the scale prints for that PLU. Which one a
  -- scale accepts from its scanner port is what the bench test settles.
  keys          text not null,
  format        text not null default 'plu' check (format in ('plu', 'barcode')),
  status        text not null default 'pending'
                check (status in ('pending', 'claimed', 'done', 'error', 'expired')),
  claimed_at    timestamptz,
  completed_at  timestamptz,
  error         text
);
-- The device poll: oldest pending row for one scale.
create index if not exists scale_callup_requests_next
  on public.scale_callup_requests (scale, created_at) where status = 'pending';
create index if not exists scale_callup_requests_recent
  on public.scale_callup_requests (created_at desc);

alter table public.scale_callup_requests enable row level security;
-- Both routes use the service role; nothing reads this with the anon key.
