-- Weekly throughput for the /exec panel: what was killed, what was cut and
-- what was packed, by Monday-start week. Aggregated in SQL because a quarter
-- of package scans is far past the API's row cap.
create or replace function public.exec_throughput_weeks(p_start date, p_end date)
returns table (
  week date, kill_head int, kill_lbs numeric, kill_days int,
  cut_head int, packed_lbs numeric, pack_days int
)
language sql stable as $$
  with weeks as (
    select generate_series(date_trunc('week', p_start::timestamp), date_trunc('week', p_end::timestamp), interval '1 week')::date w
  ),
  k as (
    select date_trunc('week', harvest_date)::date w, count(*) head,
           coalesce(sum(hot_carcass_weight_lbs), 0) lbs, count(distinct harvest_date) days
    from harvest_log where harvest_date between p_start and p_end group by 1
  ),
  c as (
    select date_trunc('week', session_date)::date w, count(distinct linked_harvest_id) head
    from processing_inputs
    where session_date between p_start and p_end and linked_harvest_id is not null group by 1
  ),
  p as (
    select date_trunc('week', (created_at at time zone 'America/Denver')::date)::date w,
           coalesce(sum(weight_lbs), 0) lbs,
           count(distinct (created_at at time zone 'America/Denver')::date) days
    from box_scans
    where (created_at at time zone 'America/Denver')::date between p_start and p_end group by 1
  )
  select weeks.w,
         coalesce(k.head, 0)::int, coalesce(k.lbs, 0), coalesce(k.days, 0)::int,
         coalesce(c.head, 0)::int, coalesce(p.lbs, 0), coalesce(p.days, 0)::int
  from weeks
  left join k on k.w = weeks.w
  left join c on c.w = weeks.w
  left join p on p.w = weeks.w
  order by weeks.w desc;
$$;
revoke all on function public.exec_throughput_weeks(date, date) from anon, authenticated;
