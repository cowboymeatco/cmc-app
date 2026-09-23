-- Producer label sets: a producer's own PLUs, kept in the app and put on the
-- Hobart only while that producer's animals are being packed.
--
-- The scale prints one label format per PLU, so the only way to put a
-- producer's own label (Blegen Galloway's) on a package is a PLU of theirs
-- set to their format. Keeping a set for every producer on the scale all the
-- time slowed the scales down (Charlie, 2026-09-23), so the sets live here and
-- get loaded when a card for that producer is coming up, and come off after.
--
-- A producer PLU is a copy of a house PLU (same scale record, same price, same
-- ingredient statement) with its own number and the producer's label format.
-- The scanner translates it back to the house PLU when a package is scanned,
-- so boxes, yields and the still-to-pack list never need to know it existed —
-- and it warns when a house PLU turns up in that producer's session.
--
-- Numbers: the package barcode carries the PLU in 5 digits (lib hobartBarcode /
-- scanner decodeBarcode), so a producer block must sit inside 1..99999. House
-- numbering stops at 11999 below the wholesale block, so producer blocks start
-- at 20000, 1000 each.
--
-- Service role only — read and written through /api/producer-labels.

create table if not exists public.producer_labels (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- What the office types on a cutting card's Scale label, matched without case.
  name             text not null,
  -- The Hobart label format number (the PLU record's l1). Null until known;
  -- a set with no format can't be exported.
  label_format     text,
  plu_block_start  integer not null check (plu_block_start between 12000 and 99000),
  -- Set when someone confirms the set is on the scales; cleared when it comes off.
  loaded_at        timestamptz,
  notes            text
);
create unique index if not exists producer_labels_name on public.producer_labels (lower(btrim(name)));
create unique index if not exists producer_labels_block on public.producer_labels (plu_block_start);

create table if not exists public.producer_plu_items (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  producer_label_id  uuid not null references public.producer_labels(id) on delete cascade,
  -- The house PLU this is a copy of (plu_items.plu_number).
  house_plu          text not null,
  plu_number         text not null unique,
  item_name          text not null,
  unique (producer_label_id, house_plu)
);
create index if not exists producer_plu_items_set on public.producer_plu_items (producer_label_id);

alter table public.producer_labels    enable row level security;
alter table public.producer_plu_items enable row level security;
revoke all on public.producer_labels, public.producer_plu_items from anon, authenticated;

-- A producer's numbers are taken even while their set is off the scale: the New
-- PLU form must never hand one out as a house item.
create or replace view public.v_used_plu_numbers as
  select plu_items.plu_number from public.plu_items where plu_items.plu_number is not null
  union
  select box_scans.plu_number from public.box_scans where box_scans.plu_number is not null
  union
  select producer_plu_items.plu_number from public.producer_plu_items;
