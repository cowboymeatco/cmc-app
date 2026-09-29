-- Whether a producer's label format on the Hobart prints a barcode.
--
-- Blegen Galloways' format (422) and Hollenbeck Ranch's (418) print a logo
-- and text but no barcode, so nothing packed on them can be scanned into a
-- box. The notes on each set said so — "weigh finished boxes as MEAT BOX
-- (PLU 1)" — but only the Producer Labels page showed the notes, and the
-- scanner's banner told the floor to key the producer's PLUs and flagged the
-- house label: exactly backwards for these two (AE, 2026-09-29: "Blegens has
-- no scan code on label. Cant scan anything in").
--
-- The scanner reads this flag: a set that prints no barcode gets a banner
-- saying to weigh the finished box as MEAT BOX (PLU 1) on the house label and
-- scan that, and house labels on its sessions stop being flagged.

alter table producer_labels
  add column if not exists prints_barcode boolean not null default true;

comment on column producer_labels.prints_barcode is
  'False when this label format prints no barcode on the Hobart: packages cannot be scanned, so finished boxes are weighed as MEAT BOX (PLU 1) on the house label.';

-- The two sets whose notes already record it.
update producer_labels set prints_barcode = false
 where notes ilike '%no barcode%';
