-- Cleaning & Sanitation — starting content. Applied 2026-08-17.
--
-- Two sources, and the difference matters:
--
--   * AREAS are inferred from the app's own production modules (harvest, cut,
--     smokehouse, packaging, coolers, retail). Safe to rename.
--
--   * TASKS marked with a CFR citation are lifted from Cowboy Meat Co.'s own
--     SSOP (rev 02.15.24, Est. M 47648). The citation travels in the detail
--     text so the crew — and an inspector reading over their shoulder — can see
--     where the requirement comes from rather than taking the app's word for it.
--
-- EQUIPMENT is deliberately NOT seeded. The SSOP is a framework document: it
-- specifies that food contact surfaces get cleaned and monitored, but contains
-- no teardown or reassembly procedure for any machine. That knowledge is not
-- written down anywhere at this plant. Inventing a grinder teardown would put
-- unverified lockout/tagout steps in front of the cleaning crew, which is worse
-- than an empty screen that asks someone to write the real one.
--
-- The grinder/mixer/stuffer CHECKLIST items below are safe to seed because they
-- name the job, not the method. The method is what has to be written by someone
-- who has actually taken the machine apart.

INSERT INTO cleaning_areas (name, sort_order, notes) VALUES
  ('Kill Floor',      10, 'Harvest / slaughter area'),
  ('Carcass Cooler',  20, 'Hanging coolers'),
  ('Cut Room',        30, 'Breaking and cutting'),
  ('Grind & Sausage', 40, 'Grinders, mixers, stuffers'),
  ('Smokehouse',      50, 'Ovens, trucks, cure room'),
  ('Packaging',       60, 'Vacuum sealing, scales, boxing'),
  ('Retail / Front',  70, 'Showcase, retail coolers, front of house'),
  ('Plant-Wide',      90, 'Floors, drains, walls, hand sinks, footbaths')
ON CONFLICT (name) DO NOTHING;

-- Daily items with no production trigger: these get done whether or not the
-- plant ran that day.
INSERT INTO cleaning_tasks (area_id, title, detail, frequency, sort_order)
SELECT a.id, t.title, t.detail, 'daily', t.ord
FROM cleaning_areas a
JOIN (VALUES
  ('Plant-Wide', 'Sweep and squeegee all floors',
   'Push water to drains — no standing water at start of shift', 10),
  ('Plant-Wide', 'Sanitize all food contact surfaces',
   'Washed and rinsed free of foreign material, then sanitized with 180°F water or an approved chemical sanitizer used per the manufacturer''s specs. SSOP pre-op procedure 1 · 9 CFR 416.12(c)', 5),
  ('Plant-Wide', 'Clean and flush floor drains',
   'Lift covers, scrub, flush, replace covers', 20),
  ('Plant-Wide', 'Scrub walls to shoulder height',
   'Where product contact or splash occurs', 30),
  ('Plant-Wide', 'Check product contact equipment for physical defects',
   'Wear, breakage, disrepair. Flag anything unserviceable rather than cleaning around it. SSOP pre-op monitoring · 9 CFR 416.13(c)', 35),
  ('Plant-Wide', 'Stock and clean hand sinks',
   'Soap, towels, hot water working', 40),
  ('Plant-Wide', 'Change footbath solution',
   'Fresh sanitizer at correct strength', 50),
  ('Plant-Wide', 'Empty trash and barrels',
   'Including inedible barrels', 60),

  ('Kill Floor', 'Wash down kill floor', 'Rails, walls, floor', 10),
  ('Kill Floor', 'Clean and sanitize hand tools',
   'Knives, hooks, saws — store clean', 20),

  ('Carcass Cooler', 'Clean rails, hooks and cooler floor', '', 10),

  ('Cut Room', 'Wash and sanitize cutting tables',
   'Full break-down of table tops', 10),
  ('Cut Room', 'Clean and sanitize cutting boards',
   'Check for deep scoring — flag if unserviceable', 20),

  ('Grind & Sausage', 'Break down, clean and sanitize the grinder',
   'Head, auger, plate, knife and ring. Lock out before any contact.', 10),
  ('Grind & Sausage', 'Break down, clean and sanitize the mixer',
   'Lock out before any contact.', 20),
  ('Grind & Sausage', 'Break down, clean and sanitize the stuffer',
   'Including the horn, piston and hopper.', 30),

  ('Smokehouse', 'Check dampers, steam injection and door seals',
   'Dampers and the steam injection system functional, door seals intact. SSOP pre-op monitoring · 9 CFR 416.13(c)', 10),
  ('Smokehouse', 'Clean and sanitize smokehouse trucks and racks', '', 20),

  ('Packaging', 'Clean and sanitize scales',
   'Wipe down platter and column — do NOT spray the head', 10),
  ('Packaging', 'Wipe down packaging tables', '', 20),

  ('Retail / Front', 'Clean and sanitize the showcase', '', 10)
) AS t(area, title, detail, ord) ON t.area = a.name
ON CONFLICT DO NOTHING;

-- The one seeded task that is production-gated: separating inspected product
-- from "Not for Sale"/wild game is an SSOP operational requirement, and it only
-- has to happen on days the plant actually cut.
INSERT INTO cleaning_tasks (area_id, title, detail, frequency, sort_order, production_triggers)
SELECT a.id,
  'Full clean-down between inspected and Not-For-Sale product',
  'Separation of state/federal product from "Not for Sale" or wild game must be maintained at all times. SSOP operational procedure · see Product ID Program',
  'daily', 40, ARRAY['cut']
FROM cleaning_areas a WHERE a.name = 'Cut Room'
ON CONFLICT DO NOTHING;
