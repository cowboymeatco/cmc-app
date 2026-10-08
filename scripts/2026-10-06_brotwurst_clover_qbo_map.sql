-- Brats fold into one BROTWURST line on the daily sales proposal.
--
-- Jill, 2026-09-30: "The scanner on clover is not grouping the brots into one
-- category, it is showing individual sales of each type." Each flavour PLU
-- (6102–6132) rings its own Clover item now that the scale labels carry a
-- barcode per PLU, and none of those items had a QuickBooks item behind it —
-- so every flavour came through as its own unmapped line and blocked the
-- post. The old combined Clover item "BROTWURST/HOT DOGS" already went to
-- QBO 1374 BROTWURST (2026-09-27 seed); the flavours go the same place.
--
-- Already applied to production on 2026-10-06. Kept here as the record.
-- POLISH SAUSAGE (6104) is left for Jill to place: it isn't a brat.

insert into public.clover_qbo_item_map (clover_item_id, clover_name, qbo_item_id, qbo_item_name, updated_by)
select p.clover_item_id, p.item_name, '1374', 'BROTWURST',
       'feedback review 2026-10-06: brat flavours fold into one BROTWURST line (Jill 2026-09-30)'
from public.plu_items p
where p.active
  and p.clover_item_id <> ''
  and (p.item_name ~* 'BROTWURST' or p.item_name ~* 'HOT DOG')
on conflict (clover_item_id) do nothing;
