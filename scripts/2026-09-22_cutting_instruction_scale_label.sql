-- Which scale label a cutting card's meat goes out on.
--
-- The Hobart carries producer-specific label formats alongside the house ones,
-- so a producer like Blegen Galloway gets their own marketing on the package.
-- Nothing on the card said so: the packager had to remember which customers
-- get which label (Jill, 2026-09-22: "Place to add label format on cutting
-- instructions").
--
-- A column rather than a key in `data`, for the same reason as the rate
-- columns: the public wizard rewrites `data` wholesale whenever the customer
-- edits their card, and this is the office's call, not the customer's.
-- Free text — the label's name and/or its format number as the scale knows it,
-- e.g. "Blegen Galloway (510)". Null = the house label.

alter table cutting_instructions
  add column if not exists scale_label text;

comment on column cutting_instructions.scale_label is
  'Producer-specific scale label this card packs on (name and/or Hobart label format #). Null = house label. Office-set; printed on the packaging sheet.';
