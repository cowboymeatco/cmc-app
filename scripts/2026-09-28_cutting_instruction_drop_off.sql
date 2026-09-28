-- Which drop-off a cutting card belongs to, when the office says so.
--
-- One card covers one animal, so a customer bringing a dozen lambs or five
-- beef on the same cuts files a dozen or five cards. The list showed them as
-- that many unrelated rows and printing gave a page pair per animal, when on
-- the floor it's all one job (Charlie, 2026-09-28: "We need a consolidation
-- method for these cards with multiple cards and multiple carcasses but in
-- reality they are all one session. CMB and Daniels come to mind.").
--
-- Set by hand from the cutting-instructions list, never inferred: two orders
-- from the same customer on the same day are not always one job. Cards that
-- share a drop_off_id list as one row and print on one cut card + packaging
-- sheet (per identical set of cuts) with an animal list for the tags.
--
-- A column rather than a key in `data`, for the same reason as scale_label:
-- the public wizard rewrites `data` wholesale when the customer edits a card.
-- Just a shared uuid, no parent table — a group is nothing but its cards.

alter table cutting_instructions
  add column if not exists drop_off_id uuid;

create index if not exists cutting_instructions_drop_off_id_idx
  on cutting_instructions (drop_off_id)
  where drop_off_id is not null;

comment on column cutting_instructions.drop_off_id is
  'Office-set: cards sharing this id are one drop-off (one job), listed and printed together. Null = a card on its own.';
