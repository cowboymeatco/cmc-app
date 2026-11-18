-- Recipe ingredient lines + label statement (2026-11-18).
--
-- A recipe was one seasoning + one cure + free-text "other adds". Real
-- formulations (the 2025 Wild Game Processing Sheet) run 4–17 ingredients:
-- water, cheese, jalapeños, a dozen spices. Each now gets its own line, in lb
-- per 100 lb of meat, so every line scales and the seasoning order list can
-- count it.
--
-- A line may point at a supply (what gets ordered). Meat and water lines don't.
-- Things measured by volume or count ("10 cups", "1 red bell pepper") keep
-- lb_per_100 null and say so in qty_note.
--
-- Purely additive: seasoning_id / cure_id stay on smokehouse_recipes. A recipe
-- with lines is read from its lines; one without falls back to those columns.
--
-- RLS on, no policies — service-role API routes only, same as the recipes.
create table if not exists smokehouse_recipe_lines (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references smokehouse_recipes(id) on delete cascade,
  sort_order  integer not null default 0,
  item        text not null,                                              -- as the crew says it
  supply_id   uuid references smokehouse_supplies(id) on delete set null, -- null: meat, water, not ordered
  lb_per_100  numeric check (lb_per_100 >= 0),                            -- lb per 100 lb of meat
  qty_note    text                                                        -- "10 cups per 100 lb", "1 per batch"
);
create index if not exists smokehouse_recipe_lines_recipe_idx on smokehouse_recipe_lines (recipe_id, sort_order);
alter table smokehouse_recipe_lines enable row level security;

-- The ingredient statement printed on the label, allergens included.
alter table smokehouse_recipes add column if not exists label_statement text;
