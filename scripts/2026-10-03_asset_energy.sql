-- Equipment energy log (Charlie, 2026-10-03).
-- Applied to prod via Supabase MCP 2026-10-03 (migration asset_energy).
--
-- What a machine actually draws, measured, and what that costs per month.
-- Nameplate wattage is the maximum rating, not what the thing uses: a
-- compressor cycles and a smoker holds temperature, so refrigeration and
-- heating typically average a third to a half of the plate. The only honest
-- number is a meter left on the circuit for a while. This is where those
-- readings land, against the same asset record the cleaning and service
-- screens use.
--
-- Two kinds of record:
--   * a reading — a meter (plug-through, panel monitor, or clamp + duty
--     cycle) ran on one asset from started_at to ended_at and accumulated
--     kwh. The app turns that into average watts and a monthly figure
--     (lib/energy); nothing derived is stored.
--   * a rate — what a kWh costs us, read off the utility bill (total bill ÷
--     total kWh). Dated, so an old reading costed under an old rate stays
--     explainable, and the newest effective rate is the one the page uses.
--
-- Same posture as the recent back-office tables: RLS on, no policies, and
-- the routes read through the service role (lib/supabaseAdmin).

-- Nameplate rating, for the "running well above plate" flag. Lives on the
-- asset because it is a fact about the machine, not about any one reading.
alter table public.assets
  add column if not exists rated_watts numeric;

create table if not exists public.asset_energy_readings (
  id           uuid        default gen_random_uuid() primary key,
  created_at   timestamptz not null default now(),
  asset_id     uuid        not null references public.assets(id) on delete cascade,
  -- The metering window. Elapsed hours come from these two, so a Kill A Watt
  -- left on for nine days and one left on for a week both scale to a month
  -- the same way.
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  kwh          numeric     not null check (kwh >= 0),
  method       text        not null default 'plug_meter'
                           check (method in ('plug_meter','panel_monitor','clamp','utility_bill')),
  -- Highest kW seen during the window, when the meter reports it. Commercial
  -- bills carry a demand charge on peak kW, so this is what says whether
  -- staggering compressor starts would pay.
  peak_kw      numeric     check (peak_kw is null or peak_kw >= 0),
  recorded_by  text,
  notes        text,
  check (ended_at > started_at)
);

create index if not exists idx_asset_energy_readings_asset
  on public.asset_energy_readings(asset_id, ended_at desc);

create table if not exists public.energy_rates (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz not null default now(),
  effective_on   date        not null,
  -- Blended $/kWh: the whole bill divided by the kWh on it, so fixed charges,
  -- riders and taxes are in the number and a machine's cost is its real
  -- share of what we pay.
  rate_per_kwh   numeric     not null check (rate_per_kwh >= 0),
  -- $/kW of billed demand, when the bill has a demand line. Null = none.
  demand_per_kw  numeric     check (demand_per_kw is null or demand_per_kw >= 0),
  utility        text,
  -- Where the number came from, e.g. "Aug 2026 bill: $2,140 / 17,300 kWh".
  source         text,
  recorded_by    text
);

create index if not exists idx_energy_rates_effective
  on public.energy_rates(effective_on desc);

alter table public.asset_energy_readings enable row level security;
alter table public.energy_rates          enable row level security;
