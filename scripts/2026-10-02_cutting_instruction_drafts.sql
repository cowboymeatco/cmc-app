-- ─────────────────────────────────────────────────────────────────────────────
-- Cutting-instruction DRAFTS — the half-finished card survives the tab.
--
-- The public form (and the portal's wizard) kept every answer in memory until
-- Submit. Charlie took Wanda Gibson's half-beef card over the phone on
-- 2026-09-28 at 4:11 PM, the form was opened, and nothing was ever posted —
-- the tab closed before Submit and the card simply did not exist. There was no
-- draft, no error, nothing for the office to find (session 2026-10-02).
--
-- Now the wizard upserts its state here a moment after every change, keyed by
-- a uuid the browser remembers, and deletes the row the instant the real card
-- inserts into cutting_instructions. Rows that never turn into a card sit here
-- for the office to see ("Unfinished cards" on /cutting-instructions) and are
-- purged after 30 days (Charlie: "hold draft for 30 just in case").
--
-- Access: the form writes with the anon key, so anon/authenticated may INSERT,
-- UPDATE and DELETE — a row's id is a random uuid only its own browser knows,
-- so there is nothing to enumerate. They may NOT read the row: drafts carry
-- names and phone numbers typed by customers. SELECT is granted on the `id`
-- column alone, because an UPDATE or DELETE ... WHERE id = ? has to read that
-- column (and under RLS needs a SELECT policy to see the row). No upsert: an
-- INSERT ... ON CONFLICT DO UPDATE wants SELECT on the whole table, so the
-- wizard inserts once and updates after. The one real read a browser needs
-- ("pick up where you left off") goes through cutting_instruction_draft(p_id),
-- a security-definer lookup of exactly one row by id. The office reads with
-- the service role.
--
-- APPLIED 2026-10-02 by hand, statement by statement (the Supabase MCP hung on
-- dollar-quoted function bodies, hence the single-quoted bodies below).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.cutting_instruction_drafts (
  id             uuid primary key,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Which front door: 'public' (cuttinginstructions.cowboymeats.com) or 'portal'.
  source         text not null default 'public',
  species        text,
  -- Where in the wizard they were, for the office strip ("got to Smokehouse").
  step           integer not null default 0,
  step_label     text,
  -- Pulled out of `data` so the office can list drafts without parsing them.
  customer_name  text,
  phone          text,
  -- Portal context, when the wizard was opened for a booked animal.
  appointment_id text,
  customer_id    uuid,
  -- The wizard's own state object, verbatim. Restoring is a straight assign.
  data           jsonb not null
);

comment on table public.cutting_instruction_drafts is
  'Autosaved cutting-wizard state. Deleted when the card submits; purged after 30 days. See scripts/2026-10-02_cutting_instruction_drafts.sql.';

create index if not exists cutting_instruction_drafts_updated_at_idx
  on public.cutting_instruction_drafts (updated_at);

-- updated_at tracks the last autosave even if the client forgets to send it.
create or replace function public.touch_cutting_instruction_draft()
returns trigger language plpgsql
as 'begin new.updated_at := now(); return new; end';

drop trigger if exists trg_touch_cutting_instruction_draft on public.cutting_instruction_drafts;
create trigger trg_touch_cutting_instruction_draft
  before update on public.cutting_instruction_drafts
  for each row execute function public.touch_cutting_instruction_draft();

-- RLS: write-only for the browser roles, no listing.
alter table public.cutting_instruction_drafts enable row level security;

revoke all on public.cutting_instruction_drafts from anon, authenticated;
grant insert, update, delete on public.cutting_instruction_drafts to anon, authenticated;
grant select (id) on public.cutting_instruction_drafts to anon, authenticated;

drop policy if exists "browser may match a draft by id" on public.cutting_instruction_drafts;
drop policy if exists "browser may save a draft"   on public.cutting_instruction_drafts;
drop policy if exists "browser may update a draft" on public.cutting_instruction_drafts;
drop policy if exists "browser may delete a draft" on public.cutting_instruction_drafts;

create policy "browser may match a draft by id"
  on public.cutting_instruction_drafts for select
  to anon, authenticated using (true);

create policy "browser may save a draft"
  on public.cutting_instruction_drafts for insert
  to anon, authenticated with check (true);

create policy "browser may update a draft"
  on public.cutting_instruction_drafts for update
  to anon, authenticated using (true) with check (true);

create policy "browser may delete a draft"
  on public.cutting_instruction_drafts for delete
  to anon, authenticated using (true);

-- The one read a browser gets: its own draft, by the id it remembered.
create or replace function public.cutting_instruction_draft(p_id uuid)
returns table (
  id uuid, updated_at timestamptz, source text, species text, step integer,
  customer_name text, appointment_id text, customer_id uuid, data jsonb
)
language sql
security definer
set search_path = public
stable
as 'select d.id, d.updated_at, d.source, d.species, d.step,
           d.customer_name, d.appointment_id, d.customer_id, d.data
      from public.cutting_instruction_drafts d
     where d.id = p_id';

revoke all on function public.cutting_instruction_draft(uuid) from public;
grant execute on function public.cutting_instruction_draft(uuid) to anon, authenticated, service_role;

-- 30-day purge, nightly at 09:10 UTC (3:10 AM MDT / 2:10 AM MST), alongside
-- the other cron.job rows this project already runs.
select cron.unschedule('purge_cutting_instruction_drafts')
 where exists (select 1 from cron.job where jobname = 'purge_cutting_instruction_drafts');

select cron.schedule(
  'purge_cutting_instruction_drafts',
  '10 9 * * *',
  'delete from public.cutting_instruction_drafts where updated_at < now() - interval ''30 days'''
);

commit;
