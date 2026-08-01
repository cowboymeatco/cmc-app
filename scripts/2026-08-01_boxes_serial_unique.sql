-- Applied to production 2026-08-01.
--
-- A box serial became load-bearing once scanning one unpacks that box for
-- repack (/api/boxes/unpack); the delivery gun already resolved a load by it
-- (/api/delivery/loadout). Both look it up with ILIKE + .maybeSingle(), which
-- THROWS on a second match — so a collision would have surfaced as a broken
-- scan on the floor rather than a warning anywhere.
--
-- Serials are CMC + YYMMDD + 4 random base-36 chars: ~1.7M per day, which is
-- unlikely to repeat but not rare enough to ignore at a few hundred boxes a
-- day. Nothing had ever enforced it.
--
-- Case-insensitive on purpose: the lookups are ILIKE, so 'cmc…' and 'CMC…'
-- must collide in the index too — otherwise the constraint would still permit
-- exactly the pair of rows the lookup cannot tell apart.
--
-- NULLs stay legal: 142 boxes predate serials, and Postgres allows repeated
-- NULLs in a unique index.
--
-- Verified clean before applying: 1523 serials, 0 duplicates (case-insensitive).
-- lib/boxes.ts createBox() redraws the serial on 23505 so a collision costs a
-- retry instead of handing the packer a failed box.

create unique index if not exists boxes_serial_number_unique_idx
  on boxes (upper(serial_number));
