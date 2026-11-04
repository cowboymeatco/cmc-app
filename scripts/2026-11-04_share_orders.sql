-- 2026-11-04 — Whole / half / quarter orders on our own animals.
--
-- Charlie: "Optimize how I can take orders for folks wanting to buy a whole,
-- half or quarter from me." Until now a buyer of a half of a Cowboy Meat
-- Company beef was only ever a customer slot on the CMC booking on /schedule:
-- nothing recorded the sale itself — no request queue, no price, no status —
-- and billing skips our own animals, so the share was never invoiced from
-- the app.
--
-- share_orders is one row per share sold (a buyer wanting two halves gets two
-- rows, because one row maps to one customer slot on one booking). It is the
-- front of the funnel — requested, confirmed, scheduled, ready, picked up — and
-- hands off to the records that already exist:
--
--   scheduled   appointment_id + appointment_customer_id point at the slot
--               /api/shares/schedule wrote on the CMC booking, so the cut
--               schedule, carcass assignment and cut-card linking all see the
--               buyer with no extra typing;
--   harvested   the hanging weight is read through carcass_assignments ->
--               harvest_log (or the booking's only carcass), never copied;
--   invoiced    billable_event_id is the row /api/shares/invoice wrote into
--               billable_events (rule_key 'share_sale') — lbs × $/lb, all-in,
--               the one line QuickBooks gets.
--
-- share_prices is the posted price list: $/lb hanging per species and portion,
-- all-in (kill and cut & wrap included — Charlie, 2026-11-04), plus the
-- QuickBooks item the sale line posts to. price_per_lb is a snapshot copied
-- onto the order when it is confirmed, so a later price change never reprices
-- a share somebody was already quoted.
--
-- Staff-only data behind service-role routes (/api/shares/*), same posture as
-- call_log: RLS on, no anon policy. The public /buy form inserts through the
-- route, not the table.

create table if not exists public.share_orders (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  status                   text not null default 'requested' check (status in (
                             'requested',   -- came in; nobody has called them yet
                             'confirmed',   -- talked to, price quoted, waiting on a kill date
                             'scheduled',   -- a slot on a CMC booking
                             'ready',       -- cut, wrapped, frozen; buyer told
                             'picked_up',
                             'cancelled')),
  -- Where the order came from: the public form, or the desk.
  source                   text not null default 'phone' check (source in ('web', 'phone', 'walk_in', 'email', 'text')),
  taken_by                 text,
  customer_id              uuid references public.customers (id) on delete set null,
  customer_name            text not null,
  phone                    text,
  email                    text,
  preferred_contact        text not null default 'Phone Call',
  species                  text not null check (species in ('Beef', 'Hog', 'Lamb')),
  portion                  text not null check (portion in ('Whole', 'Half', 'Quarter')),
  -- First of the month they would like it by; null = soonest available.
  wanted_month             date,
  fulfillment              text not null default 'pickup' check (fulfillment in ('pickup', 'delivery')),
  delivery_address         text,
  -- What they wrote on the form / told the desk, and what the desk wrote back.
  notes                    text not null default '',
  office_notes             text not null default '',
  -- Snapshot of share_prices at confirmation. Null until confirmed.
  price_per_lb             numeric(8,2),
  qbo_item_id              text,
  qbo_item_name            text,
  -- The slot on the CMC booking (harvest_appointments.customers[].id).
  appointment_id           uuid references public.harvest_appointments (id) on delete set null,
  appointment_customer_id  text,
  billable_event_id        uuid references public.billable_events (id) on delete set null,
  confirmed_at             timestamptz,
  scheduled_at             timestamptz,
  ready_at                 timestamptz,
  picked_up_at             timestamptz,
  cancelled_at             timestamptz,
  cancel_reason            text
);

create index if not exists share_orders_status      on public.share_orders (status, created_at desc);
create index if not exists share_orders_appointment on public.share_orders (appointment_id) where appointment_id is not null;
create index if not exists share_orders_customer    on public.share_orders (customer_id) where customer_id is not null;

create or replace function public.share_orders_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.share_orders_touch() from public, anon, authenticated;

drop trigger if exists trg_share_orders_touch on public.share_orders;
create trigger trg_share_orders_touch
  before update on public.share_orders
  for each row execute function public.share_orders_touch();

create table if not exists public.share_prices (
  id             uuid primary key default gen_random_uuid(),
  updated_at     timestamptz not null default now(),
  species        text not null check (species in ('Beef', 'Hog', 'Lamb')),
  portion        text not null check (portion in ('Whole', 'Half', 'Quarter')),
  -- $/lb hanging weight, all-in. Null = not for sale at this size yet; the
  -- public form hides the option.
  price_per_lb   numeric(8,2),
  -- QuickBooks product/service the sale line posts to (qbo_items.qbo_id).
  qbo_item_id    text,
  qbo_item_name  text,
  -- Typical hanging weight to quote from when the kill floor has no recent
  -- own animals of this species to average. Whole-animal pounds.
  est_hanging_lbs numeric(7,1),
  unique (species, portion)
);

insert into public.share_prices (species, portion, est_hanging_lbs) values
  ('Beef', 'Whole',   750), ('Beef', 'Half',   750), ('Beef', 'Quarter', 750),
  ('Hog',  'Whole',   200), ('Hog',  'Half',   200),
  ('Lamb', 'Whole',    60), ('Lamb', 'Half',    60)
on conflict (species, portion) do nothing;

alter table public.share_orders enable row level security;
alter table public.share_prices enable row level security;
revoke all on public.share_orders from anon, authenticated;
revoke all on public.share_prices from anon, authenticated;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists public.share_orders;
-- drop table if exists public.share_prices;
-- drop function if exists public.share_orders_touch();
