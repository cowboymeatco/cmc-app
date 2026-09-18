-- The cut room's wall screens.
--
-- Charlie, 2026-09-18: the packing bench already runs a laptop with the cut
-- card thrown up on a wall TV, and it works — the card is readable from the
-- rail instead of being a sheet of paper somebody has to walk to. The cut room
-- gets the same, at the scale the room actually needs: three TVs on the cutting
-- table, one over the packing kiosk, and room for the burger station.
--
-- HOW THE ROOM IS WIRED, because it drives the whole shape of this. Every TV is
-- an HDMI export off a computer — no smart TVs, no boxes behind the screens. One
-- laptop drives all three cutter TVs, so those are three browser windows on one
-- machine dragged onto three displays. That machine's operator is busy cutting,
-- not clicking, and the packer's TV has nobody at all standing in front of it.
--
-- So a screen NEVER holds its own state. Ask a window what it is showing and the
-- answer has to survive it being closed, reopened, dragged to another display or
-- driven from a phone in the cooler. Two tables, and the split between them is
-- the whole idea:
--
--   display_channels — WHICH ANIMAL a group of screens is looking at
--   display_screens  — WHICH VIEW of it each screen renders
--
-- The three cutter TVs share one channel, so setting the animal once moves all
-- three at the same instant and they cannot drift apart mid-carcass. They differ
-- only in view: primals on one, the day's queue and stats on the next, grind and
-- smokehouse on the third. That is why "the animal" is not a column on the
-- screen row — a per-screen animal is exactly the bug this shape prevents.

-- ── What a group of screens is looking at ──────────────────────────────

CREATE TABLE IF NOT EXISTS display_channels (
  -- 'cutroom' — the carcass on the cutting table, set by a human.
  -- 'kiosk'   — whatever session the packing scanner has open, set by the
  --             scanner itself. Nobody ever points the packer's TV by hand;
  --             it follows the gun, because the packer's hands are full.
  channel     text        PRIMARY KEY,

  -- The cut card being worked, for a channel somebody points by hand.
  -- Null is a real state, not an error: the room between animals.
  --
  -- IGNORED on a channel that carries a session_date. There the card is read
  -- back off processing_sessions on every poll instead, because scanning a
  -- CI-xxxxxxxx barcode mid-cut moves the session onto another animal and the
  -- screen has to move with it — a customer with two hogs does exactly that
  -- between animals, and an id frozen here would leave the wall checking off
  -- the first hog while the packer boxed the second.
  cutting_instruction_id  uuid,

  -- The animal itself, when it is known. Kept beside the card rather than
  -- derived from it because a carcass can be on the table before anyone has
  -- linked its card, and the tag is what the cutter recognises from ten feet.
  harvest_log_id          uuid,

  -- Snapshot of the name on the board. Denormalised on purpose: the screens
  -- must still say who they are cutting when the card row is mid-edit, and a
  -- name that changes later should not silently rewrite what the wall said.
  customer_name           text NOT NULL DEFAULT '',

  -- Only the kiosk channel uses this — a packing session is a name plus a
  -- date, and both are needed to find it again (lib/sessionLinks.ts). Setting
  -- it is what makes a channel resolve its card from the session, above.
  session_date            date,

  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Who moved the room on. Free text, same as the rest of the plant's
  -- attribution: 'kiosk' when the scanner wrote it, a crew name otherwise.
  updated_by  text        NOT NULL DEFAULT ''
);

INSERT INTO display_channels (channel, updated_by) VALUES
  ('cutroom', 'seed'),
  ('kiosk',   'seed')
ON CONFLICT (channel) DO NOTHING;

-- ── One TV ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS display_screens (
  -- What goes in the URL: /display/cut1. Short because somebody types it into
  -- a browser bar on a machine with no keyboard shortcuts set up.
  screen      text        PRIMARY KEY,

  -- What the crew calls it out loud, for the control board.
  label       text        NOT NULL DEFAULT '',

  -- primals — the color-banded primal boards, the cut card at wall size
  -- queue   — the day's rail order, head and hanging weight
  -- grind   — trim, ground blend, patties and the smokehouse orders
  -- split   — primals down one half, stats and queue down the other
  view        text        NOT NULL DEFAULT 'primals'
              CHECK (view IN ('primals', 'queue', 'grind', 'split')),

  channel     text        NOT NULL DEFAULT 'cutroom'
              REFERENCES display_channels(channel),

  -- Order on the control board, left to right as the room is laid out.
  sort        int         NOT NULL DEFAULT 0,

  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The room as it stands: three over the cutting table, one over the packing
-- kiosk, one at the burger setup. A screen nobody has hung yet costs a row and
-- a line on the control board, which is cheaper than the crew waiting on a
-- migration the day the TV goes up.
INSERT INTO display_screens (screen, label, view, channel, sort) VALUES
  ('cut1',  'Cutting table — primals', 'primals', 'cutroom', 1),
  ('cut2',  'Cutting table — queue',   'queue',   'cutroom', 2),
  ('cut3',  'Cutting table — grind',   'grind',   'cutroom', 3),
  ('pack',  'Packing kiosk',           'split',   'kiosk',   4),
  ('grind', 'Burger setup',            'grind',   'cutroom', 5)
ON CONFLICT (screen) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────
--
-- Permissive policy, matching how the rest of the app reaches Supabase (anon
-- key, gated at the app layer). Nothing here is customer data the cut card
-- doesn't already carry — these two tables hold pointers, not answers.

ALTER TABLE display_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE display_screens  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS display_channels_all ON display_channels;
CREATE POLICY display_channels_all ON display_channels
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS display_screens_all ON display_screens;
CREATE POLICY display_screens_all ON display_screens
  FOR ALL USING (true) WITH CHECK (true);
