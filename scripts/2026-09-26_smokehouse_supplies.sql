-- Seasoning order list (2026-09-26): what the smokehouse buys or mixes, and
-- what each house blend is made of.
--
-- A supply is either BOUGHT (a bag from a supplier: seasoning, cure, a raw
-- spice) or a BLEND the plant mixes itself from other supplies. A blend's
-- lines give each ingredient as % by weight, so a blend need explodes into
-- ingredient needs — that's how "build our own seasonings" plugs in without a
-- second system.
--
-- Recipes point at a supply (seasoning_id / cure_id) so the order list can add
-- them up. Purely additive: the old free-text seasoning_name /
-- seasoning_supplier / cure_name columns stay in place, unused by the app.
--
-- RLS on, no policies: service-role API routes only, same as smokehouse_recipes.
create table if not exists smokehouse_supplies (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  name           text not null,
  kind           text not null default 'bought' check (kind in ('bought', 'blend')),
  supplier       text,
  pack_lb        numeric,        -- lb per bag/case as it's ordered
  lead_days      integer,        -- order → on the shelf
  on_hand_lb     numeric,        -- last count
  counted_at     timestamptz,
  cost_per_lb    numeric,
  notes          text,
  active         boolean not null default true,
  updated_by     text
);
create unique index if not exists smokehouse_supplies_name_key on smokehouse_supplies (lower(name));
alter table smokehouse_supplies enable row level security;

create table if not exists smokehouse_blend_lines (
  id             uuid primary key default gen_random_uuid(),
  blend_id       uuid not null references smokehouse_supplies(id) on delete cascade,
  ingredient_id  uuid not null references smokehouse_supplies(id) on delete restrict,
  pct            numeric not null check (pct > 0),   -- % of the blend by weight
  unique (blend_id, ingredient_id),
  check (blend_id <> ingredient_id)
);
alter table smokehouse_blend_lines enable row level security;

alter table smokehouse_recipes
  add column if not exists seasoning_id uuid references smokehouse_supplies(id) on delete set null,
  add column if not exists cure_id      uuid references smokehouse_supplies(id) on delete set null;
