-- What the floor's shorthand stands for.
--
-- Cure tags and cut sheets are matched on the customer name, and nameKey()
-- already closes case, spacing, punctuation and word order. It cannot close an
-- abbreviation: nothing in a string says "MVML" is Montana Veterans Meat
-- Locker, so Kristin's 8 tagged pieces matched none of her 9 cut sheets.
--
-- That fact only a person has. Charlie, 2026-08-27: "yes MVML is Montana
-- Veterans Meat Locker." So it lives here as data he can add to, rather than as
-- a rule buried in code — the same shape as the Clover linking: a deterministic
-- match, with a human supplying what only a human knows.
--
-- One row per TOKEN, not per whole name: "MVML" expands inside "MVML KRISTIN"
-- and "KRISTIN MVML" alike, and any customer under the same locker is picked up
-- for free. Expansion runs before the words are sorted, so word order still
-- doesn't matter.
--
-- APPLIED 2026-08-27. Do not re-run.

create table if not exists customer_name_aliases (
  alias       text primary key,          -- a single token, upper case: 'MVML'
  expands_to  text not null,             -- what it stands for: 'Montana Veterans Meat Locker'
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);

comment on table customer_name_aliases is
  'Token expansions for customer-name matching (lib/nameKey.ts). One row per abbreviation the floor types.';

-- Read-only to the app; a new alias is a deliberate act, not something a page
-- can do by accident.
alter table customer_name_aliases enable row level security;

drop policy if exists customer_name_aliases_read on customer_name_aliases;
create policy customer_name_aliases_read on customer_name_aliases
  for select to anon, authenticated using (true);

-- Confirmed by Charlie 2026-08-27. "MT" is only ever Montana in this plant's
-- customer names — checked against every live cut sheet before adding it, and
-- Kristin's are the only names it touches.
insert into customer_name_aliases (alias, expands_to, note, created_by) values
  ('MVML', 'Montana Veterans Meat Locker', 'Confirmed by Charlie 2026-08-27', 'Charlie'),
  ('MT',   'Montana',                      'Only ever Montana in customer names here', 'Charlie')
on conflict (alias) do nothing;
