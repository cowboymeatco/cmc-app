-- Cleaning & Sanitation — phase 1 schema.
--
-- A mobile tool for the night cleaning crew: equipment teardown/reassembly
-- procedures, the nightly checklist, photo documentation, supply requests, and
-- a shared issue inbox with the day production crew.
--
-- Deliberately built record-grade even though phase 1 is a helper tool and the
-- paper SSOP forms stay the official record. The two things that are expensive
-- to retrofit — per-person attribution and immutable history — are here from
-- the start, so promoting this to the real pre-op/post-op record later is a
-- policy decision rather than a migration:
--
--   * every completion carries who did it, by id AND by name snapshot
--   * shift items snapshot their title/area/equipment at build time, so editing
--     a template tonight never rewrites what last month's record said
--   * checklist items can carry a typed reading (sanitizer ppm, water temp)
--     alongside the checkmark — the column is here now, unused until a task
--     turns it on
--
-- RLS is enabled on every table with a permissive policy, matching how the rest
-- of the app reaches Supabase (anon key, gated at the app layer). The point is
-- that these tables arrive already enrolled rather than adding to the 35-table
-- backlog the advisor flags — tightening the policy later touches one line per
-- table instead of a fresh migration per table.

-- ── Where things are, and what's in them ────────────────────────────────

CREATE TABLE IF NOT EXISTS cleaning_areas (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  name        text        NOT NULL UNIQUE,       -- 'Kill Floor', 'Cut Room', 'Grind Room'
  sort_order  int         NOT NULL DEFAULT 100,  -- the order the crew walks the plant
  active      boolean     NOT NULL DEFAULT true,
  notes       text
);

CREATE TABLE IF NOT EXISTS cleaning_equipment (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  area_id     uuid        NOT NULL REFERENCES cleaning_areas(id) ON DELETE CASCADE,
  name        text        NOT NULL,              -- 'Biro Grinder', 'Vacuum Tumbler'
  make_model  text,
  sort_order  int         NOT NULL DEFAULT 100,
  active      boolean     NOT NULL DEFAULT true,
  -- Honest about the gap: procedures exist for some equipment and live in
  -- people's heads for the rest. Equipment with no steps shows as
  -- "not documented yet" rather than as an empty procedure.
  notes       text,
  UNIQUE (area_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cleaning_equipment_area ON cleaning_equipment(area_id);

-- ── The procedure: how it comes apart, gets cleaned, and goes back ──────

CREATE TABLE IF NOT EXISTS cleaning_steps (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  equipment_id  uuid        NOT NULL REFERENCES cleaning_equipment(id) ON DELETE CASCADE,
  phase         text        NOT NULL CHECK (phase IN ('teardown','clean','reassemble')),
  step_no       int         NOT NULL,
  instruction   text        NOT NULL,
  -- A REFERENCE photo: permanent, part of the procedure, "this is how the
  -- auger seats". Distinct from the per-shift documentation photos in
  -- cleaning_photos, which are proof that tonight's work happened.
  photo_url     text,
  caution       text,                            -- lockout/tagout, sharp parts, chemical
  -- English is the only language the UI renders today. The column means adding
  -- Spanish is data entry, not a rebuild: {"es": "Retire el tornillo sinfín"}
  translations  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (equipment_id, phase, step_no)
);

CREATE INDEX IF NOT EXISTS idx_cleaning_steps_equipment ON cleaning_steps(equipment_id, phase, step_no);

-- Crew-submitted corrections to a step. The people doing the work nightly know
-- where the written procedure is wrong; this captures that without letting the
-- procedure drift silently.
CREATE TABLE IF NOT EXISTS cleaning_step_suggestions (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  step_id      uuid        REFERENCES cleaning_steps(id) ON DELETE CASCADE,
  equipment_id uuid        NOT NULL REFERENCES cleaning_equipment(id) ON DELETE CASCADE,
  suggestion   text        NOT NULL,
  photo_url    text,
  suggested_by text        NOT NULL,
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','declined')),
  reviewed_at  timestamptz,
  reviewed_by  text
);

CREATE INDEX IF NOT EXISTS idx_cleaning_step_suggestions_status ON cleaning_step_suggestions(status);

-- ── The master checklist ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  area_id       uuid        NOT NULL REFERENCES cleaning_areas(id) ON DELETE CASCADE,
  -- Nullable: plenty of tasks are area-level ("squeegee the floor drains") and
  -- belong to no machine.
  equipment_id  uuid        REFERENCES cleaning_equipment(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  detail        text,
  sort_order    int         NOT NULL DEFAULT 100,
  active        boolean     NOT NULL DEFAULT true,

  frequency     text        NOT NULL DEFAULT 'daily'
                            CHECK (frequency IN ('daily','weekly','monthly','quarterly')),
  -- 0=Sunday .. 6=Saturday, for weekly tasks. Null on a weekly task means "any
  -- night that week", which the builder treats as due from the start of the
  -- week and overdue at the end of it.
  weekday       int         CHECK (weekday BETWEEN 0 AND 6),
  day_of_month  int         CHECK (day_of_month BETWEEN 1 AND 28),

  -- Production-aware filtering. NULL = always on the list. Otherwise the task
  -- only appears on nights the plant actually did one of these things, so the
  -- grinder teardown doesn't pad the list on a day nobody ground anything.
  -- Values: harvest | cut | grind | stuff | smoke | package | retail
  production_triggers text[],

  -- Photo required to check this one off (over and above the shift-level
  -- documentation photos).
  requires_photo boolean    NOT NULL DEFAULT false,

  -- The flow to readings. Phase 1 ships every task as 'none' — a checkmark and
  -- an optional note. Turning on sanitizer ppm or final-rinse temp is then a
  -- row edit in the admin screen, not a schema change.
  input_type    text        NOT NULL DEFAULT 'none'
                            CHECK (input_type IN ('none','number','text')),
  input_label   text,                            -- 'Sanitizer concentration'
  input_unit    text,                            -- 'ppm', '°F'
  input_min     numeric,                         -- below this is out of spec
  input_max     numeric,
  translations  jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_area   ON cleaning_tasks(area_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_active ON cleaning_tasks(active);

-- ── A night's work ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cleaning_shifts (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  shift_date    date        NOT NULL UNIQUE,     -- the production day being cleaned up after
  started_at    timestamptz DEFAULT now(),
  started_by    text,
  closed_at     timestamptz,
  closed_by     text,
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  -- What the builder saw in production when it built the list. Kept so a
  -- short list a month from now can be explained rather than second-guessed.
  production_seen text[],
  notes         text
);

CREATE TABLE IF NOT EXISTS cleaning_shift_items (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  shift_id      uuid        NOT NULL REFERENCES cleaning_shifts(id) ON DELETE CASCADE,
  -- Nullable, and ON DELETE SET NULL rather than CASCADE: deleting a template
  -- task must never erase the history of the nights it was done.
  task_id       uuid        REFERENCES cleaning_tasks(id) ON DELETE SET NULL,
  equipment_id  uuid        REFERENCES cleaning_equipment(id) ON DELETE SET NULL,

  -- Snapshots, not lookups. Editing a template tonight can't rewrite what last
  -- month's record said was done.
  title         text        NOT NULL,
  detail        text,
  area_name     text        NOT NULL,
  equipment_name text,
  requires_photo boolean    NOT NULL DEFAULT false,
  input_type    text        NOT NULL DEFAULT 'none'
                            CHECK (input_type IN ('none','number','text')),
  input_label   text,
  input_unit    text,
  input_min     numeric,
  input_max     numeric,

  -- Where this item came from, so a short or long list is explainable:
  -- scheduled = due by frequency; production = pulled in by what ran today;
  -- issue = promoted off the day crew's report; manual = someone added it.
  source        text        NOT NULL DEFAULT 'scheduled'
                            CHECK (source IN ('scheduled','production','issue','manual')),
  sort_order    int         NOT NULL DEFAULT 100,

  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','done','na','issue')),
  -- Shared shift: several people sign in and check off what they did, so
  -- attribution is per item, not per shift. Name is snapshotted alongside the
  -- id for the same reason the titles are.
  done_by_id    uuid,
  done_by       text,
  done_at       timestamptz,
  note          text,
  value_num     numeric,                         -- when input_type = 'number'
  value_text    text                             -- when input_type = 'text'
);

CREATE INDEX IF NOT EXISTS idx_cleaning_shift_items_shift  ON cleaning_shift_items(shift_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_shift_items_status ON cleaning_shift_items(shift_id, status);

-- Per-shift proof photos. Separate table from cleaning_steps.photo_url on
-- purpose: reference photos are permanent and few, documentation photos are
-- per-night and many, and they get pruned on different schedules.
CREATE TABLE IF NOT EXISTS cleaning_photos (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  shift_id      uuid        NOT NULL REFERENCES cleaning_shifts(id) ON DELETE CASCADE,
  shift_item_id uuid        REFERENCES cleaning_shift_items(id) ON DELETE CASCADE,
  url           text        NOT NULL,
  storage_path  text,
  caption       text,
  taken_by      text
);

CREATE INDEX IF NOT EXISTS idx_cleaning_photos_shift ON cleaning_photos(shift_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_photos_item  ON cleaning_photos(shift_item_id);

-- ── One inbox, two intents ──────────────────────────────────────────────

-- Day crew flags something for tonight ('heads_up'), or reports that last
-- night's cleaning missed something ('miss'). Same table, because the crew
-- shouldn't have to categorise their own complaint precisely to be heard, and
-- because both end up as work for the same people.
CREATE TABLE IF NOT EXISTS cleaning_issues (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  intent        text        NOT NULL DEFAULT 'heads_up'
                            CHECK (intent IN ('heads_up','miss')),
  area_id       uuid        REFERENCES cleaning_areas(id) ON DELETE SET NULL,
  equipment_id  uuid        REFERENCES cleaning_equipment(id) ON DELETE SET NULL,
  area_name     text,
  equipment_name text,
  description   text        NOT NULL,
  photo_url     text,
  reported_by   text        NOT NULL,
  severity      text        NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal','urgent')),

  status        text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','scheduled','resolved','declined')),
  -- Set when the issue gets pulled onto a night's list, which is what closes
  -- the loop back to the person who reported it.
  shift_item_id uuid        REFERENCES cleaning_shift_items(id) ON DELETE SET NULL,
  -- For a 'miss', which night it was a miss from.
  about_shift_id uuid       REFERENCES cleaning_shifts(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  resolved_by   text,
  resolution_note text,
  page_url      text                              -- where in the app it was filed from
);

CREATE INDEX IF NOT EXISTS idx_cleaning_issues_status ON cleaning_issues(status, created_at DESC);

-- ── Supplies ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cleaning_supplies (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  name        text        NOT NULL UNIQUE,       -- 'Foaming Chlorinated Detergent'
  unit        text,                              -- 'case', '5 gal pail', 'box'
  vendor      text,
  sku         text,
  -- Par levels are in the schema but unused by phase 1's UI, which is a plain
  -- request list. Counting on-hand is a habit worth having before it's a
  -- feature; the columns wait until the habit exists.
  par_level   numeric,
  on_hand     numeric,
  sort_order  int         NOT NULL DEFAULT 100,
  active      boolean     NOT NULL DEFAULT true,
  notes       text
);

CREATE TABLE IF NOT EXISTS cleaning_supply_requests (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  supply_id     uuid        REFERENCES cleaning_supplies(id) ON DELETE SET NULL,
  -- Free text for anything not in the catalog yet — the crew should never be
  -- blocked from asking for something because nobody set it up first.
  name_text     text        NOT NULL,
  qty           text,                            -- '2 cases' — free text, not a number
  urgency       text        NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','out')),
  requested_by  text        NOT NULL,
  note          text,
  status        text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','ordered','received','cancelled')),
  ordered_at    timestamptz,
  received_at   timestamptz,
  handled_by    text
);

CREATE INDEX IF NOT EXISTS idx_cleaning_supply_requests_status ON cleaning_supply_requests(status, created_at DESC);

-- ── Who's on tonight ────────────────────────────────────────────────────

-- Named sign-in with no password: the crew picks their name off a list. It is
-- attribution, not authentication — it answers "who checked this off" for a
-- sanitation record, and nothing more. The plant-network and passphrase gates
-- are what keep strangers out.
CREATE TABLE IF NOT EXISTS cleaning_crew (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  name        text        NOT NULL UNIQUE,
  role        text        NOT NULL DEFAULT 'crew' CHECK (role IN ('crew','lead')),
  sort_order  int         NOT NULL DEFAULT 100,
  active      boolean     NOT NULL DEFAULT true
);

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE cleaning_areas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_equipment         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_steps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_step_suggestions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_shifts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_shift_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_photos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_issues            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_supplies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_supply_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_crew              ENABLE ROW LEVEL SECURITY;

-- Matches how the rest of the app talks to Supabase today (anon key from the
-- server routes, access controlled at the app layer). Named policies rather
-- than an open table so tightening them later is an ALTER POLICY on a thing
-- that already exists.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cleaning_areas','cleaning_equipment','cleaning_steps','cleaning_step_suggestions',
    'cleaning_tasks','cleaning_shifts','cleaning_shift_items','cleaning_photos',
    'cleaning_issues','cleaning_supplies','cleaning_supply_requests','cleaning_crew'
  ]
  LOOP
    -- Dropped first so the whole file stays re-runnable; Postgres has no
    -- CREATE POLICY IF NOT EXISTS.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t || '_app_access', t
    );
  END LOOP;
END $$;
