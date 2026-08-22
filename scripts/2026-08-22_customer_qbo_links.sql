-- Cut customer -> QuickBooks customer recognition.
--
-- Billing already resolves a QBO customer id for PRODUCERS (producer_qbo_links,
-- 17 rows). The other payer on every split — the person who actually bought the
-- animal — got an empty string, so no charge billed to a cut customer could ever
-- reach QuickBooks. Same gap blocks "days from slaughter to invoice": an animal
-- can't be tied to its invoice if we don't know which QBO customer it belongs to
-- (Charlie, 2026-08-22).
--
-- Deliberately a SEPARATE table from producer_qbo_links rather than a `kind`
-- column on it. The two are different relationships — a producer is who dropped
-- the animal off, a cut customer is who takes a share of it — and the same name
-- can legitimately be both, on the same animal, billed for different lines.
-- Merging them would need a composite key and would make every existing
-- producer lookup ambiguous.
--
-- Measured before building (payers since 2026-06-01): 189 distinct cut customer
-- names, 60 (32%) matching an active QBO customer on the normalized key, 43 of
-- the remaining 129 within trigram reach of one. So roughly half resolve with a
-- confirm-each-one pass and the rest are a human decision or a customer that
-- does not exist in QuickBooks yet.

create table if not exists public.customer_qbo_links (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- The name exactly as it appears on the appointment's customer slot. Free
  -- text, so several spellings can legitimately point at one QBO customer —
  -- the unique is on OUR name, never on theirs.
  customer_name    text not null unique,
  qbo_customer_id  text not null
);

-- Same posture as producer_qbo_links: staff-side linking, service role only.
alter table public.customer_qbo_links enable row level security;

-- Trigram index over the cache's existing norm_name. NOT over exec_name_key():
-- a functional index has to CALL that function on every write, and the anon role
-- the customer-cache sync runs as has no execute grant on it — the first sync
-- after that index went on failed with "permission denied for function
-- exec_name_key". norm_name is already maintained and is what the linking route
-- matches on anyway.
create extension if not exists pg_trgm;
create index if not exists qbo_customers_norm_trgm
  on public.qbo_customers using gin (norm_name gin_trgm_ops);

-- Best fuzzy candidates for a batch of our names. The floor is deliberately low
-- (0.30) and the similarity is returned so the screen can show how weak a
-- suggestion is: real drift scores badly. "Treasure Belles" -> "TREASURE BELLS
-- CATTLE WOMEN" is only 0.42 and sits barely above "Treasure State BBQ" at 0.40,
-- and the top candidate for "Wendy Racki" is "RACKI, RJ" — a different person.
-- Nothing here is ever applied automatically; a wrong link invoices the wrong
-- customer, so below an EXACT key match a human confirms every one.
create or replace function public.qbo_customer_candidates(
  names text[], min_sim real default 0.30, per_name int default 5
)
returns table (our_name text, qbo_id text, display_name text, sim real)
language sql stable as $$
  select n.name, c.qbo_id, c.display_name, c.sim
  from unnest(names) as n(name)
  cross join lateral (
    select q.qbo_id, q.display_name,
           similarity(q.norm_name, upper(regexp_replace(n.name,'[^A-Za-z0-9]+',' ','g'))) as sim
    from public.qbo_customers q
    where q.active
      and q.norm_name % upper(regexp_replace(n.name,'[^A-Za-z0-9]+',' ','g'))
    order by sim desc
    limit per_name
  ) c
  where c.sim >= min_sim;
$$;

-- APPLIED to production 2026-08-22, together with a customer-cache refresh. The
-- cache had last synced 2026-07-19; a month of new QuickBooks customers were
-- missing, and refreshing it moved the exact-match rate from 32% to 54% on its
-- own. Cache age is the single biggest lever on how much of this screen is
-- manual — the page shows it for that reason.
