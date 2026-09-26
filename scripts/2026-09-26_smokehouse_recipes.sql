-- Smokehouse recipe book: one row per flavour, written down while the people
-- who carry it in their heads are still here (2026-09-26).
--
-- Wizard flavours (sticks/brots/summer/jerky) link by wizard_flavor_id so the
-- recipe follows the flavour the customer picked on the cut sheet. House
-- products with no wizard flavour (hot dogs, bacon cure, ham brine…) are free
-- rows with wizard_flavor_id null.
--
-- Formulations are trade secrets: RLS on, NO policies — only the service-role
-- API route (/api/smokehouse-recipes) reads or writes it.
create table if not exists smokehouse_recipes (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  wizard_flavor_id     uuid unique references wizard_flavors(id) on delete set null,
  product              text not null,
  label                text not null,
  seasoning_name       text,
  seasoning_supplier   text,
  seasoning_lb_per_100 numeric,   -- lb of seasoning per 100 lb of meat
  cure_name            text,
  cure_oz_per_100      numeric,   -- oz of cure per 100 lb of meat
  other_adds           text,      -- cheese, water, binder… free text with amounts
  casing_type          text,      -- collagen | cellulose | natural | fibrous | none
  casing_size          text,
  steps                text,      -- mixing order, stuffing, anything done from memory
  notes                text,
  updated_by           text       -- the name typed on save; never inferred
);

alter table smokehouse_recipes enable row level security;
