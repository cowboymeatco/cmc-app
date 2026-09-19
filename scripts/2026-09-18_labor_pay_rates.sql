-- Hourly pay rate per QuickBooks Time user, for the /exec daily labor panel.
-- Keyed on the QuickBooks Time user id (the id on every timesheet). Rates are
-- copied from QuickBooks Payroll "Regular Pay" and are NOT in this repo (it's
-- public) — seed/update them with SQL. Service role only: RLS on, no policies.
create table if not exists public.labor_pay_rates (
  qbt_user_id bigint primary key,
  name        text not null,
  hourly_rate numeric(8,2) not null,
  source      text not null default 'QBO Payroll Regular Pay',
  updated_at  timestamptz not null default now()
);
alter table public.labor_pay_rates enable row level security;
revoke all on public.labor_pay_rates from anon, authenticated;
