-- "Box is empty": a permanent record of packages written off as missing.
--
-- Charlie, 2026-09-28: "I have scanned out everything and the box is empty so
-- obviously someone pulled from the box without scanning it out. How do we
-- treat this scenario where it is empty?"
--
-- Until now the only ways to clear the leftover lines were a silent delete, or
-- Repack, which books the weight as meat going into a repack and inflates
-- yield. A write-off keeps a snapshot of what the system thought was in the
-- box, why it's gone and who said so, then the box is retired so it stops
-- counting as stock on hand.
--
-- APPLIED 2026-09-28. Do not re-run.

create table if not exists public.box_writeoffs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  box_id         uuid not null,          -- no FK: the box row is retired afterwards
  box_serial     text,
  customer_name  text not null,
  pack_date      date not null,
  box_number     integer,
  reason         text not null check (reason in ('missing', 'damaged', 'other')),
  note           text,
  written_off_by text,
  cuts           integer not null,
  weight_lbs     numeric not null,
  lines          jsonb not null          -- the box_scans rows written off, as they were
);
create index if not exists box_writeoffs_customer_idx on public.box_writeoffs (customer_name, pack_date);
alter table public.box_writeoffs enable row level security;
