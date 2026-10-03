-- Clover Capital advance in the register close email (Charlie, 2026-10-03).
-- Applied to prod via Supabase MCP 2026-10-03 (migration clover_capital).
--
-- Clover's API can't see Clover Capital (nor the deposits it's repaid from),
-- so the advance is what a person reads off the Clover dashboard
-- (Finances → Clover Capital) and types on /billing. The app then carries it
-- forward itself: every shop day it files the card batch and the 25% Clover
-- keeps from it (lib/cloverCapital), so the 5:00 PM email can say what's
-- still owed once the batches Clover hasn't paid out yet land, and about
-- when the advance pays off at the recent pace.

-- The advance, as the dashboard shows it. One row per advance number; the
-- open one (closed_date null, latest updated) is what the email reports.
-- Dollar figures on the dashboard are whole dollars; cents here are ×100.
create table if not exists public.clover_capital_advance (
  advance_number     text primary key,
  advance_cents      integer not null,                    -- "Advance amount"
  payback_cents      integer not null,                    -- paid to date + balance due: all Clover collects
  funded_date        date,                                -- "Date funded"
  holdback_rate      numeric(5,4) not null default 0.25,  -- share of each card batch Clover keeps
  last_payment_date  date not null,                       -- "Last Payment Date": payouts through this day are in paid_cents
  paid_cents         integer not null,                    -- "Total paid to date"
  balance_cents      integer not null,                    -- "Total balance due"
  closed_date        date,                                -- "Closed Date", once Clover shows one
  updated_by         text,
  updated_at         timestamptz not null default now()
);
alter table public.clover_capital_advance enable row level security;

-- Clover Capital advance 249552336883, from the dashboard on 2026-10-03:
-- $17,207 funded 06/23/2026, last payment 10/01/2026, $5,572 paid, $14,217 due.
insert into public.clover_capital_advance
  (advance_number, advance_cents, payback_cents, funded_date, holdback_rate, last_payment_date, paid_cents, balance_cents, updated_by)
values
  ('249552336883', 1720700, 1978900, '2026-06-23', 0.25, '2026-10-01', 557200, 1421700, 'Charlie, from the Clover dashboard 2026-10-03')
on conflict (advance_number) do nothing;

-- One row per shop day: the card batch as the register report read it and
-- the holdback Clover takes from it. Written by the 5:00 PM report; earlier
-- days it hasn't seen are filled in a few at a time (lib/cloverCapital).
create table if not exists public.clover_card_days (
  business_date     date primary key,
  card_gross_cents  integer not null,
  holdback_cents    integer not null,
  read_at           timestamptz not null default now()
);
alter table public.clover_card_days enable row level security;
