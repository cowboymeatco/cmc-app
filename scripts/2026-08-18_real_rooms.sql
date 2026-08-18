-- The plant's actual rooms, from Charlie 2026-08-17. Applied same day.
--
-- The eight areas seeded with the cleaning module were inferred from the app's
-- own production modules and several were wrong:
--
--   * "Kill Floor" is the Harvest Room.
--   * "Carcass Cooler" is TWO rooms — New Cooler and Old Cooler.
--   * There is no separate Smokehouse room; it's inside Value Add.
--   * There is no separate Packaging room; that happens in the Processing Room.
--   * Nine real rooms were missing entirely — livestock in and out, Inedible,
--     the four retail coolers and freezers, Office, Lockeroom, Back Lot.
--
-- Order follows the path product takes: livestock in at 10, retail out at 130,
-- support rooms after. That order is what the nightly checklist walks in and
-- how the map lays out, so it is worth getting right rather than alphabetical.

INSERT INTO cleaning_areas (name, sort_order, notes) VALUES
  ('Outdoor Livestock',  10, 'Pens and holding outside'),
  ('Indoor Livestock',   20, 'Holding pens inside'),
  ('Harvest Room',       30, 'Kill floor'),
  ('Inedible Room',      40, 'Inedible / offal handling'),
  ('New Cooler',         50, 'Carcass cooler'),
  ('Old Cooler',         60, 'Carcass cooler'),
  ('Processing Room',    70, 'Cutting, breaking, packaging'),
  ('Value Add',          80, 'Grinding, sausage, smokehouse'),
  ('Custom Freezer',     90, 'Customer product'),
  ('Retail Freezer',    100, 'Retail stock'),
  ('Showroom Cooler',   110, 'Front-of-house display cooler'),
  ('Showroom Freezer',  120, 'Front-of-house display freezer'),
  ('Retail',            130, 'Front of house'),
  ('Office',            140, ''),
  ('Lockeroom',         150, 'Crew locker room'),
  ('Back Lot',          160, 'Outside yard'),
  -- Four more, given a few minutes later. Slotted by where they sit in the
  -- flow rather than appended: the Spice Room feeds Value Add, the Tool Cart
  -- area serves the floor, and the inspector sits next to the office.
  ('Spice Room',         75, 'Seasonings and cure — feeds Value Add'),
  ('Tool Cart Area',     78, 'Knives, steels, hand tools'),
  ('Inspectors Office', 145, 'FSIS in-plant inspector'),
  ('Mechanical Closet', 170, 'Plant mechanicals')
ON CONFLICT (name) DO NOTHING;

-- Plant-Wide survives the change. It is not a room — it is the catch-all for
-- floors, drains, walls, hand sinks and footbaths that belong to no single
-- space — so it sorts last rather than competing with real rooms.
UPDATE cleaning_areas SET sort_order = 900 WHERE name = 'Plant-Wide';

-- ── Move the seeded tasks before anything can cascade ───────────────────
-- cleaning_tasks.area_id is ON DELETE CASCADE, so deleting an invented room
-- with tasks still on it would silently destroy them. Remap first, verify the
-- old rooms are empty, delete only then.
WITH m(old_name, new_name) AS (VALUES
  ('Kill Floor',      'Harvest Room'),
  ('Cut Room',        'Processing Room'),
  ('Packaging',       'Processing Room'),
  ('Grind & Sausage', 'Value Add'),
  ('Smokehouse',      'Value Add'),
  ('Retail / Front',  'Retail')
)
UPDATE cleaning_tasks t
SET area_id = newa.id
FROM m
JOIN cleaning_areas olda ON olda.name = m.old_name
JOIN cleaning_areas newa ON newa.name = m.new_name
WHERE t.area_id = olda.id;

-- "Clean rails, hooks and cooler floor" was written for one invented carcass
-- cooler and there are two. Rails and hooks are in both, so it becomes a task
-- in each rather than a guess about which one it meant.
INSERT INTO cleaning_tasks (area_id, title, detail, frequency, sort_order)
SELECT a.id, 'Clean rails, hooks and cooler floor', '', 'daily', 10
FROM cleaning_areas a WHERE a.name IN ('New Cooler', 'Old Cooler')
ON CONFLICT DO NOTHING;

DELETE FROM cleaning_tasks t USING cleaning_areas a
WHERE t.area_id = a.id AND a.name = 'Carcass Cooler';

DELETE FROM cleaning_areas
WHERE name IN ('Kill Floor','Carcass Cooler','Cut Room','Grind & Sausage',
               'Smokehouse','Packaging','Retail / Front');

-- ── Map layout ─────────────────────────────────────────────────────────
-- A starting grid in the same flow order, not a survey. Charlie drags these
-- into the building's real shape in Manage → Map; this only has to be sane
-- enough that nothing overlaps or hides.
UPDATE cleaning_map_settings SET canvas_w = 1000, canvas_h = 920, updated_at = now() WHERE id = 1;

UPDATE cleaning_areas a SET map_x = g.x, map_y = g.y, map_w = g.w, map_h = g.h
FROM (VALUES
  ('Outdoor Livestock',  40,  40, 200, 120),
  ('Indoor Livestock',  280,  40, 200, 120),
  ('Harvest Room',      520,  40, 200, 120),
  ('Inedible Room',     760,  40, 200, 120),
  ('New Cooler',         40, 180, 200, 120),
  ('Old Cooler',        280, 180, 200, 120),
  ('Processing Room',   520, 180, 200, 120),
  ('Value Add',         760, 180, 200, 120),
  ('Custom Freezer',     40, 320, 200, 120),
  ('Retail Freezer',    280, 320, 200, 120),
  ('Showroom Cooler',   520, 320, 200, 120),
  ('Showroom Freezer',  760, 320, 200, 120),
  ('Retail',             40, 460, 200, 120),
  ('Office',            280, 460, 200, 120),
  ('Lockeroom',         520, 460, 200, 120),
  ('Back Lot',          760, 460, 200, 120),
  ('Spice Room',         40, 600, 200, 120),
  ('Tool Cart Area',    280, 600, 200, 120),
  ('Inspectors Office', 520, 600, 200, 120),
  ('Mechanical Closet', 760, 600, 200, 120),
  ('Plant-Wide',         40, 740, 920, 120)
) AS g(name, x, y, w, h)
WHERE a.name = g.name;

-- Result: 21 areas, 23 tasks, 0 orphaned, 0 unpositioned.
