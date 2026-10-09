-- Waste hauling log (Charlie, 2026-10-09).
-- Applied to prod via Supabase MCP 2026-10-09 (migration waste_hauls).
--
-- "Pounds in, pounds out." Every animal that comes through the kill floor is
-- weighed on the way in (hanging weight, live weight when the producer has
-- it); what leaves the building as waste — offal, bone, fat, hide, paunch —
-- never was. It rides to the Colstrip landfill in barrels and totes and the
-- only number anyone has is a feeling. This table is where the scale weight
-- of each haul lands, so waste can sit beside the hanging pounds for the same
-- stretch of days and come out as a percentage.
--
-- One row per trip. Weighing can happen two ways and the row carries both:
--   * container by container on the shop scale before loading — each weight
--     goes in container_weights, the total is gross_lbs, and tare_lbs is the
--     empty containers;
--   * on the landfill scale — truck in loaded (gross), out empty (tare), and
--     the ticket number for the fee.
-- net_lbs is stored rather than generated because either path can also just
-- hand us a net figure straight off a ticket.
--
-- Same posture as the other back-office tables: RLS on, no policies, and the
-- route reads through the service role (lib/supabaseAdmin).

create table if not exists public.waste_hauls (
  id                 uuid        default gen_random_uuid() primary key,
  created_at         timestamptz not null default now(),
  hauled_on          date        not null,
  destination        text        not null default 'Colstrip landfill',
  -- What was on the load. Mixed is the honest default: a kill-day run is a
  -- little of everything.
  kind               text        not null default 'mixed'
                     check (kind in ('mixed','offal','bone','fat','hide','paunch','other')),
  gross_lbs          numeric     check (gross_lbs is null or gross_lbs >= 0),
  tare_lbs           numeric     check (tare_lbs  is null or tare_lbs  >= 0),
  net_lbs            numeric     not null check (net_lbs >= 0),
  -- How the number was taken, so a shop-scale figure and a landfill-ticket
  -- figure for the same week can be told apart.
  weigh_method       text        not null default 'shop_scale'
                     check (weigh_method in ('shop_scale','landfill_scale','estimate')),
  container_count    integer     check (container_count is null or container_count >= 0),
  -- Each barrel or tote as it came off the shop scale, in order, when the
  -- haul was weighed that way. Sums to gross_lbs.
  container_weights  numeric[],
  ticket_no          text,
  fee_dollars        numeric     check (fee_dollars is null or fee_dollars >= 0),
  -- Off the truck's dash, same as delivery_runs, so a Colstrip run can be
  -- costed per mile out of the freight pool.
  odometer_out       numeric(9,1),
  odometer_in        numeric(9,1),
  hauled_by          text,
  notes              text,
  check (odometer_in is null or odometer_out is null or odometer_in >= odometer_out)
);

create index if not exists idx_waste_hauls_hauled_on
  on public.waste_hauls(hauled_on desc);

alter table public.waste_hauls enable row level security;
