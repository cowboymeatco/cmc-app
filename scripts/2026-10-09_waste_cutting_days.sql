-- Cutting-floor waste by processing day (Charlie, 2026-10-09, /waste: "For
-- processing days we should be able to calculate carcass weight - package
-- weight and have that give us a total for how much we threw away of product
-- in a day.")
-- Applied to prod via Supabase MCP 2026-10-09 (migration waste_cutting_days).
--
-- Carcass in: the hanging weight scanned into processing sessions that day,
-- each side counted once even when two customers split it into quarters (the
-- same box_identifier lands in two sessions; the yield route dedupes the same
-- way). Packaged out: every package that crossed the scale that day, by the
-- scan's own clock on Mountain time, same as the /exec throughput panel.
-- Aggregated in SQL because a month of package scans is past the API row cap.
--
-- Single days bleed into each other — a side scanned in Tuesday afternoon is
-- boxed Wednesday — so a day can read negative. The window total is the
-- honest number; the page says so.
create or replace function public.waste_cutting_days(p_start date, p_end date)
returns table (
  day date, head int, sides int, carcass_lbs numeric, packages int, packed_lbs numeric
)
language sql stable as $$
  with ins as (
    select session_date d, coalesce(box_identifier, id::text) ident, linked_harvest_id, max(weight_lbs) w
    from processing_inputs
    where session_date between p_start and p_end
      and (input_type = 'carcass' or linked_harvest_id is not null)
    group by 1, 2, 3
  ),
  c as (
    select d, count(distinct linked_harvest_id) head, count(*) sides, coalesce(sum(w), 0) lbs
    from ins group by d
  ),
  p as (
    select (created_at at time zone 'America/Denver')::date d,
           count(*) packages, coalesce(sum(weight_lbs), 0) lbs
    from box_scans
    where (created_at at time zone 'America/Denver')::date between p_start and p_end
    group by 1
  )
  select coalesce(c.d, p.d),
         coalesce(c.head, 0)::int, coalesce(c.sides, 0)::int, coalesce(c.lbs, 0),
         coalesce(p.packages, 0)::int, coalesce(p.lbs, 0)
  from c full join p on c.d = p.d
  order by 1 desc;
$$;
revoke all on function public.waste_cutting_days(date, date) from anon, authenticated;
