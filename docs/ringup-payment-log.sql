-- ringup_payment_log: one row per register payment the app records in QuickBooks
-- (lib/ringUpPayments). NOT APPLIED. Test mode doesn't need it; apply it only
-- when going live, with Charlie's go-ahead, before RINGUP_PAYMENTS_POSTING_FROM
-- is set. Without this table the live run refuses before touching QuickBooks.
--
-- key = <clover order id>:<clover line id>:<tender>. The primary key is the
-- duplicate guard: a row is claimed (status 'posting') before the QuickBooks
-- write, so a second run or a second press can't record the same payment.

create table if not exists public.ringup_payment_log (
  key              text primary key,
  business_date    date not null,
  clover_order_id  text not null,
  clover_line_id   text not null,
  tender           text not null,
  doc_number       text not null,
  qbo_invoice_id   text,
  qbo_customer_id  text,
  customer_name    text,
  amount_cents     integer not null,
  status           text not null check (status in ('posting', 'recorded', 'error')),
  qbo_payment_id   text,
  reason           text,
  error            text,
  triggered_by     text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists ringup_payment_log_order_idx on public.ringup_payment_log (clover_order_id);
create index if not exists ringup_payment_log_date_idx on public.ringup_payment_log (business_date);

-- Server only, like qbo_tokens: the app writes it with the service role.
alter table public.ringup_payment_log enable row level security;
