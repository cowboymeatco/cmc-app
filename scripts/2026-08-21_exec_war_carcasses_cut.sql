-- Carcasses cut — the number that was missing from the exec Operations row.
--
-- /exec labelled two tiles "Carcasses in" and "Carcasses out". "Out" was
-- harv_out: a COUNT OF KILLS off harvest_log.harvest_date. On a Friday, with
-- the kill floor quiet and the crew breaking beef all day, it read 0 — which
-- looks like nothing left the building (Charlie, 2026-08-21: "what calculates
-- off of the carcasses out? we should have at least a bunch of beef headed
-- out").
--
-- Two things were wrong. The tiles were named for a DIRECTION rather than for
-- what they count (fixed on the page: "Animals received" / "Harvested"), and
-- the number Charlie was actually looking for — how many carcasses came off
-- the rail to be broken — was never on the dashboard at all. This adds it.
--
-- One count per DISTINCT animal scanned into a packing session. An input row
-- with no linked carcass can't be attributed to an animal, so it is left out
-- rather than guessed at; that makes this a slight undercount on days the crew
-- scans a box in without tying it to a tag.
--
-- APPLIED to production 2026-08-21. Re-running is harmless (CREATE OR REPLACE),
-- but the definition below must stay in step with the live function — the WAR
-- SMS on the shop desktop reads the same jsonb, so a key removed here goes
-- missing there too. Adding keys is safe; renaming or dropping them is not.

CREATE OR REPLACE FUNCTION public.exec_war_metrics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH p AS (
  SELECT (now() AT TIME ZONE 'America/Denver')::date AS today,
         (date_trunc('week',(now() AT TIME ZONE 'America/Denver'))::date) AS wk_lo
)
SELECT jsonb_build_object(
 'today',      to_char((SELECT today FROM p),'Dy Mon FMDD'),
 'week_since', to_char((SELECT wk_lo FROM p),'Mon FMDD'),
 'recv_in_d',  (SELECT count(*) FROM animal_receiving_log a,p WHERE a.received_at::date=p.today AND a.status IS DISTINCT FROM 'removed'),
 'recv_in_w',  (SELECT count(*) FROM animal_receiving_log a,p WHERE a.received_at::date BETWEEN p.wk_lo AND p.today AND a.status IS DISTINCT FROM 'removed'),
 'harv_out_d', (SELECT count(*) FROM harvest_log h,p WHERE h.harvest_date=p.today),
 'harv_out_w', (SELECT count(*) FROM harvest_log h,p WHERE h.harvest_date BETWEEN p.wk_lo AND p.today),
 -- Carcasses that came OFF the rail and got broken: one per distinct animal
 -- scanned into a packing session. This is the "headed out the door" number
 -- (Charlie, 2026-08-21) — harv_out above is the KILL count, which reads as 0
 -- on any day the floor isn't harvesting even while beef is being cut.
 -- Counts only inputs tied to a carcass; a box scanned in without a linked
 -- animal can't be attributed to one and is deliberately not guessed at.
 'cut_out_d',  (SELECT count(DISTINCT i.linked_harvest_id) FROM processing_inputs i,p WHERE i.session_date=p.today AND i.linked_harvest_id IS NOT NULL),
 'cut_out_w',  (SELECT count(DISTINCT i.linked_harvest_id) FROM processing_inputs i,p WHERE i.session_date BETWEEN p.wk_lo AND p.today AND i.linked_harvest_id IS NOT NULL),
 'livelb_d',   (SELECT COALESCE(sum(live_weight_lbs),0) FROM harvest_log h,p WHERE h.harvest_date=p.today),
 'livelb_w',   (SELECT COALESCE(sum(live_weight_lbs),0) FROM harvest_log h,p WHERE h.harvest_date BETWEEN p.wk_lo AND p.today),
 'hot_d',      (SELECT COALESCE(sum(hot_carcass_weight_lbs),0) FROM harvest_log h,p WHERE h.harvest_date=p.today),
 'hot_w',      (SELECT COALESCE(sum(hot_carcass_weight_lbs),0) FROM harvest_log h,p WHERE h.harvest_date BETWEEN p.wk_lo AND p.today),
 'pin_d',      (SELECT COALESCE(sum(weight_lbs),0) FROM processing_inputs i,p WHERE i.session_date=p.today),
 'pin_w',      (SELECT COALESCE(sum(weight_lbs),0) FROM processing_inputs i,p WHERE i.session_date BETWEEN p.wk_lo AND p.today),
 'pout_d',     (SELECT COALESCE(sum(weight_lbs),0) FROM box_scans b,p WHERE (b.created_at AT TIME ZONE 'America/Denver')::date=p.today),
 'pout_w',     (SELECT COALESCE(sum(weight_lbs),0) FROM box_scans b,p WHERE (b.created_at AT TIME ZONE 'America/Denver')::date BETWEEN p.wk_lo AND p.today),
 'rate_d',     (SELECT ROUND(COALESCE(sum(weight_lbs),0)/NULLIF(EXTRACT(EPOCH FROM (max(created_at)-min(created_at)))/3600.0,0),0) FROM box_scans b,p WHERE (b.created_at AT TIME ZONE 'America/Denver')::date=p.today),
 'cooks_d',    (SELECT count(*) FROM smokehouse_cook c,p WHERE (c.started_at AT TIME ZONE 'America/Denver')::date=p.today),
 'cooks_w',    (SELECT count(*) FROM smokehouse_cook c,p WHERE (c.started_at AT TIME ZONE 'America/Denver')::date BETWEEN p.wk_lo AND p.today)
);
$function$;
