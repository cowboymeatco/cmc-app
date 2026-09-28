-- Producer PLUs move to four digits (Charlie, 2026-09-28).
--
-- The Hobarts look a PLU up as soon as the configured number of digits is
-- keyed, one setting for the whole scale. The packers key four, so a 2xxxx
-- producer PLU could only be reached by switching every scale to five and
-- adding a key press to every house item. Producers now share 9100–9899,
-- 100 numbers a set (lib/producerLabels.ts), which nothing in the book uses.
--
-- Renumbers each existing set in creation order (Blegen 9100, Hollenbeck 9200)
-- and its PLUs to the same offset in the new block. Nothing had been scanned
-- under a 2xxxx producer number, so no box_scans row refers to the old ones.
-- Any old numbers already sent to a scale stay there until deleted by hand.

alter table public.producer_labels drop constraint if exists producer_labels_plu_block_start_check;

with renum as (
  select id, plu_block_start as old_start,
         9100 + 100 * (row_number() over (order by plu_block_start) - 1) as new_start
  from public.producer_labels
  where plu_block_start >= 12000
)
update public.producer_plu_items i
   set plu_number = (r.new_start + (i.plu_number::int - r.old_start))::text
  from renum r
 where i.producer_label_id = r.id;

with renum as (
  select id, 9100 + 100 * (row_number() over (order by plu_block_start) - 1) as new_start
  from public.producer_labels
  where plu_block_start >= 12000
)
update public.producer_labels l set plu_block_start = r.new_start from renum r where l.id = r.id;

alter table public.producer_labels add constraint producer_labels_plu_block_start_check
  check (plu_block_start between 9100 and 9800 and plu_block_start % 100 = 0);
