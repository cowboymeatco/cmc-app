-- ─────────────────────────────────────────────────────────────────────────────
-- Time clock: keep every correction, void instead of delete, finish the lockdown.
--
-- From the 2026-11-01 payroll cutover review of /timekeeping:
--   • A manager's fix to a punch overwrote the punched times. Now every add,
--     edit and void writes a tk_shift_history row with the punches before and
--     after, the reason, and when — the record a wage question is answered from.
--   • Deleting a shift erased it, reason and all. A shift punched by mistake is
--     now voided: voided_at + void_note on the row, left out of hours and
--     balances, shown from the change log.
--   • RLS was on for every tk_ table with no policies, but table grants to anon
--     and authenticated were never revoked (RLS does not stop TRUNCATE). Same
--     posture as the 2026-09-29 back-office lockdown, applied to tk_*.
--
-- Pairs with the cmc-app commit that writes the history and filters voided
-- shifts; apply together.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.tk_shifts
  add column if not exists voided_at timestamptz,
  add column if not exists void_note text;

-- One open shift per person — a voided one shouldn't hold the slot.
drop index if exists public.tk_shifts_one_open;
create unique index tk_shifts_one_open on public.tk_shifts (employee_id) where clock_out is null and voided_at is null;

create table if not exists public.tk_shift_history (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.tk_shifts (id),
  employee_id uuid not null references public.tk_employees (id),
  shop_date   date not null,                 -- the shift's day, so a pay week's changes are one range query
  action      text not null check (action in ('add', 'edit', 'void')),
  before      jsonb,                         -- punches as they were (null for add)
  after       jsonb,                         -- punches as they became (null for void)
  note        text not null,
  at          timestamptz not null default now()
);
create index if not exists tk_shift_history_emp_date on public.tk_shift_history (employee_id, shop_date);
create index if not exists tk_shift_history_shift    on public.tk_shift_history (shift_id, at);

-- Service role only, like the rest of tk_*: RLS on, no policies, grants gone.
do $$
declare t text;
begin
  foreach t in array array[
    'tk_config', 'tk_employees', 'tk_kiosk_sessions', 'tk_pin_failures', 'tk_punch_photos',
    'tk_schedule', 'tk_shifts', 'tk_time_off_requests', 'tk_shift_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;

-- Check after: kiosk punches in and out, a manager edit shows under "Changes"
-- on Timesheets, a voided shift drops off the hours and shows there too.
