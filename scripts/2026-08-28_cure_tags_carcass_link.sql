-- Pin a cure tag to the animal it came off.
--
-- A seal knows whose piece it is and not which of their animals, so a customer
-- with several head has their tags shown against every one of their sheets.
-- Tolerable for one hog and one hog; useless for Montana Veterans Meat Locker,
-- who books five hogs under one account for five different end buyers — four
-- hams under "MVML KRISTIN" could be any two of them (Charlie, 2026-08-27).
--
-- Nullable on purpose, and it stays null for the ordinary single-animal
-- customer where there is nothing to choose. Nothing infers it: it is set by a
-- person on Processing → In Cure, because which hog a ham came off is knowledge
-- the floor has and the database does not.
--
-- APPLIED 2026-08-28. Do not re-run.

alter table cure_tags
  add column if not exists linked_harvest_id uuid references harvest_log(id) on delete set null;

comment on column cure_tags.linked_harvest_id is
  'The carcass this piece came off, pinned by hand when a customer has more than one animal. Null = not pinned; the tag shows against all of that customer''s sheets.';

create index if not exists cure_tags_linked_harvest_idx
  on cure_tags (linked_harvest_id) where linked_harvest_id is not null;
