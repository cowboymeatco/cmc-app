-- 2026-10-27 — Front-desk call log (Charlie: "the phone is nuts").
--
-- One row per customer phone call, typed in by whoever took it. The point is
-- not the individual call; it is the tally. Each call gets one category from
-- the fixed list in lib/callCategories.ts, and /calls counts them by week so
-- we can see which questions the website, the booking confirmation or a text
-- blast should be answering before the phone rings.
--
-- customer_id is optional: the entry form offers a match from `customers` as
-- the name is typed, but a cold caller is logged with just a name and number.
--
-- Staff-only data behind a service-role route (/api/calls), the same shape as
-- feedback and scale_callup_requests: RLS on, no anon policy.
--
-- Applied to production via the Supabase migration "call_log" on 2026-10-27.

create table if not exists public.call_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- When the phone rang. Defaults to the moment it was logged; the form lets
  -- the desk back-date one they logged after the rush.
  called_at     timestamptz not null default now(),
  taken_by      text not null,
  caller_name   text,
  caller_phone  text,
  customer_id   uuid references public.customers (id) on delete set null,
  category      text not null check (category in (
                  'status', 'scheduling', 'pricing', 'pickup',
                  'cut_sheet', 'billing', 'order', 'other')),
  -- What they asked, in the caller's words as near as the desk can manage.
  question      text not null,
  -- What we told them. Optional: "called back later" is a fine answer.
  answer        text
);

create index if not exists call_log_called_at on public.call_log (called_at desc);
create index if not exists call_log_customer  on public.call_log (customer_id) where customer_id is not null;

alter table public.call_log enable row level security;
-- /api/calls uses the service role; nothing reads this with the anon key.
