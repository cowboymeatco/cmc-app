-- Plant-wide kanban ordering (2026-09-27).
--
-- Charlie: "build my whole Kanban system for ordering in the CMC app — price,
-- vendor info, ordering info, lead times and anything else lean manufacturing
-- calls for."
--
-- Three tables:
--   kanban_vendors  who we buy from and HOW: contact, account #, order method,
--                   order days + cutoff, delivery days, default lead time,
--                   minimum order, free-freight line, terms.
--   kanban_items    the card: what it is, where it lives (point of use +
--                   backstock), card type and how many cards are in the loop,
--                   what one card orders (kanban quantity), unit of measure vs
--                   order unit, price, vendor + SKU, alternate vendor, lead
--                   time, daily usage and safety days (the sizing inputs).
--   kanban_signals  one pulled card, start to finish: pulled → ordered (PO,
--                   expected date) → received (qty, price paid). Actual lead
--                   time falls out of these rows and feeds back to the item.
--
-- The older cleaning_supplies / cleaning_supply_requests tables are left in
-- place (their shelf QR codes are already taped up); their active items are
-- copied in below so the plant has one board. smokehouse_supplies is NOT
-- copied — seasonings are ordered off booked demand (lib/seasoningOrders.ts),
-- which is MRP, not a replenishment loop.
--
-- RLS on, no policies: service-role API routes only. Account numbers and
-- prices are not for the public anon key.

create table if not exists kanban_vendors (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  name              text not null,
  contact_name      text,
  phone             text,
  email             text,
  website           text,
  account_number    text,
  order_method      text not null default 'phone'
                    check (order_method in ('phone', 'email', 'web', 'text', 'rep', 'other')),
  order_days        text[] not null default '{}',   -- 'Mon'…'Sun'; empty = any day
  order_cutoff      text,                           -- e.g. '2 PM MT'
  delivery_days     text[] not null default '{}',
  lead_days         integer,                        -- order → on our dock
  min_order         numeric,                        -- $
  free_freight_at   numeric,                        -- $
  payment_terms     text,
  notes             text,
  active            boolean not null default true,
  updated_by        text
);
create unique index if not exists kanban_vendors_name_key on kanban_vendors (lower(name));
alter table kanban_vendors enable row level security;

create table if not exists kanban_items (
  id                    uuid primary key default gen_random_uuid(),
  card_no               integer generated always as identity,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  name                  text not null,
  description           text,
  category              text not null default 'Other',
  location              text,              -- point of use: where the working bin lives
  backstock_location    text,              -- where the second bin / reserve lives
  card_type             text not null default 'two_bin'
                        check (card_type in ('two_bin', 'reorder_point', 'single')),
  cards_in_loop         integer not null default 2 check (cards_in_loop between 1 and 20),
  unit                  text,              -- what you use/count: each, roll, gal, lb
  order_unit            text,              -- what you buy: case, pail, box
  units_per_order_unit  numeric,           -- e.g. 6 rolls per case
  order_qty             numeric,           -- order units per pulled card (the kanban qty)
  min_order_qty         numeric,           -- vendor MOQ, in order units
  bin_qty               numeric,           -- units in one full bin/container
  reorder_point         numeric,           -- units; for reorder-point cards
  price                 numeric,           -- $ per order unit
  price_updated_at      timestamptz,
  vendor_id             uuid references kanban_vendors(id) on delete set null,
  vendor_sku            text,
  alt_vendor_id         uuid references kanban_vendors(id) on delete set null,
  alt_vendor_sku        text,
  manufacturer          text,
  mfg_part_no           text,
  lead_days             integer,           -- overrides the vendor's
  daily_usage           numeric,           -- units/day, average
  safety_days           numeric not null default 2,
  owner                 text,              -- who places the order
  order_instructions    text,
  sds_url               text,
  notes                 text,
  learned_lead_days     numeric,           -- average of received signals
  last_ordered_at       timestamptz,
  last_received_at      timestamptz,
  active                boolean not null default true,
  updated_by            text
);
create unique index if not exists kanban_items_card_no_key on kanban_items (card_no);
create unique index if not exists kanban_items_name_key on kanban_items (lower(name));
create index if not exists kanban_items_vendor_idx on kanban_items (vendor_id);
alter table kanban_items enable row level security;

create table if not exists kanban_signals (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  item_id         uuid not null references kanban_items(id) on delete cascade,
  card_seq        integer,                 -- which card of the loop (1…n)
  status          text not null default 'pulled'
                  check (status in ('pulled', 'ordered', 'received', 'cancelled')),
  urgency         text not null default 'normal' check (urgency in ('normal', 'out')),
  qty             numeric,                 -- order units asked for
  source          text not null default 'board' check (source in ('scan', 'board')),
  pulled_by       text not null,
  pulled_at       timestamptz not null default now(),
  vendor_id       uuid references kanban_vendors(id) on delete set null,
  unit_price      numeric,                 -- $/order unit at the time
  ordered_by      text,
  ordered_at      timestamptz,
  po_number       text,
  expected_on     date,
  received_by     text,
  received_at     timestamptz,
  received_qty    numeric,
  note            text
);
create index if not exists kanban_signals_open_idx on kanban_signals (status, pulled_at desc);
create index if not exists kanban_signals_item_idx on kanban_signals (item_id, pulled_at desc);
-- A physical card can only be out once at a time.
create unique index if not exists kanban_signals_card_out_key
  on kanban_signals (item_id, card_seq)
  where status in ('pulled', 'ordered') and card_seq is not null;
alter table kanban_signals enable row level security;

-- ── Seed from the cleaning supply list ──────────────────────────────────
insert into kanban_vendors (name, updated_by)
select distinct on (lower(trim(vendor))) trim(vendor), 'import: cleaning supplies'
from cleaning_supplies
where active and nullif(trim(vendor), '') is not null
on conflict do nothing;

insert into kanban_items (name, category, unit, order_unit, vendor_id, vendor_sku, notes, updated_by)
select s.name, 'Cleaning & Sanitation', s.unit, s.unit, v.id, s.sku, s.notes, 'import: cleaning supplies'
from cleaning_supplies s
left join kanban_vendors v on lower(v.name) = lower(trim(s.vendor))
where s.active
on conflict do nothing;
