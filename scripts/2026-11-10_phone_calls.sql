-- 2026-11-10 — Phone calls as the PBX saw them (Charlie: "logs would be amazing").
--
-- One row per external call, posted by the 3CX phone system when the call
-- ends (app/api/pbx/report, template in scripts/3cx/cmc-app.xml). This is the
-- machine's record: who called, who answered, when, how long, and whether it
-- was answered at all. The desk's write-up of what the caller wanted stays in
-- call_log; the two meet through call_log.phone_call_id so a hand-written
-- entry can hang off the call it describes, and the Log a Call page can offer
-- the calls nobody has written up yet.
--
-- customer_id is set when the number matched a customer at lookup time; a
-- stranger's call is logged with just the number.
--
-- Staff-only data behind a service-role route, the same shape as call_log:
-- RLS on, no anon policy.
--
-- NOT YET APPLIED. Run as a Supabase migration "phone_calls" when the 3CX
-- side is ready to send.

create table if not exists public.phone_calls (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- 3CX's verdict on the call. 'missed' and 'notanswered' are inbound calls
  -- nobody picked up; 3CX draws the line between the two, not us.
  call_type        text not null check (call_type in ('inbound', 'outbound', 'missed', 'notanswered')),
  direction        text not null check (direction in ('inbound', 'outbound')),
  -- The outside number as 3CX reported it, and its digits only for matching.
  number           text not null,
  number_digits    text not null,
  customer_id      uuid references public.customers (id) on delete set null,
  -- Name the lookup handed 3CX at ring time ("Unknown caller" for a stranger).
  contact_name     text,
  -- Extension that handled the call. '' (not null) so it can sit in the
  -- dedupe key below; a missed call on a ring group has no agent.
  agent_ext        text not null default '',
  agent_name       text,
  agent_email      text,
  -- Ring group or queue the call came through, if it did.
  queue_ext        text,
  started_at       timestamptz not null,
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  -- Only populated if the PBX has recording + transcription turned on.
  transcription    text,
  summary          text,
  recording_url    text,
  -- Everything 3CX sent, for the day a field turns up under a new name.
  raw              jsonb not null default '{}'::jsonb
);

-- 3CX can report the same call twice (service restart, retry after a slow
-- response). The report route upserts with ignoreDuplicates on this key.
create unique index if not exists phone_calls_dedupe
  on public.phone_calls (started_at, number, agent_ext);

create index if not exists phone_calls_started_at on public.phone_calls (started_at desc);
create index if not exists phone_calls_customer   on public.phone_calls (customer_id) where customer_id is not null;
create index if not exists phone_calls_digits     on public.phone_calls (number_digits);

alter table public.phone_calls enable row level security;
-- /api/pbx/* use the service role; nothing reads this with the anon key.

-- A desk write-up can point at the PBX record it describes. Optional, and
-- nothing is backfilled: calls logged before this existed have no PBX row.
alter table public.call_log
  add column if not exists phone_call_id uuid references public.phone_calls (id) on delete set null;

create index if not exists call_log_phone_call on public.call_log (phone_call_id) where phone_call_id is not null;
