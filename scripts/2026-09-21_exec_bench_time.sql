-- How long an animal actually takes at the packing scale.
--
-- Charlie asked for a timestamp on the scanner marking a cut card finished, to
-- get packing hours per head. The data turned out to already hold the answer,
-- and the timestamp would have given a WRONG one: the clock from first scan to
-- last is wall time, and an animal that sits half-packed overnight reads as a
-- day of labour. Miles City Insurance on 9/15 spans 3,192 minutes; Dalton
-- Packard, a beef of the same size, spans 109.
--
-- So this counts only the gaps between scans that are short enough to be work.
-- Over the last 60 days 92% of gaps are under a minute and the 95th percentile
-- is 2.3 minutes — the rhythm at the scale is seconds. Ten minutes is four
-- times that, so a longer gap is a break, a shift change or the next morning,
-- and none of those are packing. The threshold is a parameter so it can be
-- argued with rather than buried.
--
-- ⚠️ This is TIME AT THE SCALE, not labour cost. It excludes the cutting and
-- wrapping that happen before a package reaches the scale, and it counts one
-- clock no matter how many people are on the bench. Set beside the ~18-23 lb
-- per CREW hour on the throughput panel it will look twenty times better;
-- they measure different things and neither is wrong. For crew-minutes on a
-- job, use the timing study at /exec/study.
--
-- Aggregated in SQL for the same reason exec_throughput_weeks is: package
-- scans are far past the API's row cap.
create or replace function public.exec_bench_time(
  p_start date,
  p_end   date,
  p_gap_cap_min numeric default 10
)
returns table (
  customer_name text,
  pack_date     date,
  species       text,
  head          int,
  scans         int,
  lbs           numeric,
  active_min    numeric,
  wall_min      numeric
)
language sql stable as $$
  with scan as (
    select b.customer_name, b.pack_date, bs.created_at, bs.weight_lbs,
           extract(epoch from (bs.created_at - lag(bs.created_at)
             over (partition by b.customer_name, b.pack_date order by bs.created_at)))/60.0 as gap_min
    from box_scans bs
    join boxes b on b.id = bs.box_id
    where b.pack_date between p_start and p_end
  ),
  agg as (
    select customer_name, pack_date,
           count(*)::int as scans,
           coalesce(sum(weight_lbs), 0) as lbs,
           coalesce(sum(case when gap_min <= p_gap_cap_min then gap_min else 0 end), 0) as active_min,
           extract(epoch from (max(created_at) - min(created_at)))/60.0 as wall_min
    from scan group by customer_name, pack_date
  ),
  -- The animal behind the session, for a per-species standard. A session with
  -- no carcass scanned into it (retail, repack) has no species and is left
  -- null rather than guessed at.
  animal as (
    select pi.customer_name, pi.session_date,
           min(hl.species) as species,
           count(distinct pi.linked_harvest_id)::int as head
    from processing_inputs pi
    join harvest_log hl on hl.id = pi.linked_harvest_id
    where pi.session_date between p_start and p_end
      and pi.linked_harvest_id is not null
    group by pi.customer_name, pi.session_date
  )
  select agg.customer_name, agg.pack_date,
         animal.species, coalesce(animal.head, 0)::int,
         agg.scans, round(agg.lbs, 1),
         round(agg.active_min, 1), round(agg.wall_min, 0)
  from agg
  left join animal
    on animal.customer_name = agg.customer_name
   and animal.session_date  = agg.pack_date
  order by agg.pack_date desc, agg.lbs desc;
$$;

revoke all on function public.exec_bench_time(date, date, numeric) from anon, authenticated;
