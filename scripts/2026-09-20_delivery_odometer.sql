-- Odometer out and back on a delivery run. Two numbers off the truck's dash,
-- not off a person: with them, the freight pool in QuickBooks (fuel, vehicle
-- repairs, the truck lease) turns into a cost per mile and per route.
alter table public.delivery_runs
  add column if not exists odometer_out numeric(9,1),
  add column if not exists odometer_in  numeric(9,1);
