-- Reading the scales back (Charlie, 2026-09-26).
--
-- The app has always known what it SENDS to the Hobart scales, never what is
-- ON them. The kiosk proved on 2026-09-26 that it can read both back without
-- changing anything: every PLU record (HCT's READ_ALL_ITEMS, request RT53 —
-- 407 PLUs off .190, each with its label format l1) and every label format
-- (READ_ALL_LABELS — 38 RT9C records, whose logos name the producer: 422 is
-- Blegen Galloways, 418 Hollenbeck Ranch, 413 Central Montana Beef).
--
-- A read is asked for here and done by the kiosk, which is the only machine on
-- the shop LAN. Deliberately a table of its OWN, not a new kind on
-- scale_push_requests: the running watcher treats any kind it doesn't know as
-- a full price push to every scale, so a new kind there would push prices
-- until the kiosk is updated. The old watcher never reads this table.
--
-- Same access as scale_push_requests: the kiosk talks to Supabase with the key
-- in its config.json.

create table if not exists public.scale_read_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  requested_by  text,
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  -- null = every scale in the kiosk's config.json
  scales        text[],
  result        jsonb,
  completed_at  timestamptz
);

-- One read of one scale. `what` is which HCT read it was.
create table if not exists public.scale_reads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  request_id    uuid references public.scale_read_requests(id) on delete set null,
  scale_ip      text not null,
  what          text not null check (what in ('plu', 'label')),
  ok            boolean not null default true,
  record_count  integer,
  error         text
);
create index if not exists scale_reads_latest on public.scale_reads (scale_ip, what, created_at desc);

-- Every RT89 record of a PLU read, as the scale holds it.
create table if not exists public.scale_plu_records (
  read_id       uuid not null references public.scale_reads(id) on delete cascade,
  plu_number    text not null,
  item_name     text,                 -- dt, first line (the scale name)
  label_format  text,                 -- l1
  fields        jsonb not null,       -- every field code -> value
  primary key (read_id, plu_number)
);

-- Every RT9C record of a label read. The formats carry no free-text name; the
-- logo and text objects in them are what say whose label it is.
create table if not exists public.scale_label_formats (
  read_id        uuid not null references public.scale_reads(id) on delete cascade,
  format_number  text not null,
  internal_name  text,                -- e.g. LT_422
  texts          text[] not null default '{}',   -- logo names and text lines
  fields         jsonb not null,
  primary key (read_id, format_number)
);

alter table public.scale_read_requests enable row level security;
alter table public.scale_reads         enable row level security;
alter table public.scale_plu_records   enable row level security;
alter table public.scale_label_formats enable row level security;
create policy "ops full access" on public.scale_read_requests for all to anon, authenticated using (true) with check (true);
create policy "ops full access" on public.scale_reads         for all to anon, authenticated using (true) with check (true);
create policy "ops full access" on public.scale_plu_records   for all to anon, authenticated using (true) with check (true);
create policy "ops full access" on public.scale_label_formats for all to anon, authenticated using (true) with check (true);
