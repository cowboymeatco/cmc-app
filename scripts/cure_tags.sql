-- Applied 2026-07-30 (Supabase migration `cure_tags`) — kept here as documentation.
--
-- Cure tags: numbered tamper seals (LeadSeals barcode zip-ties) attached to
-- hams/bacons on the cut floor before they go to the cure cooler. The seal
-- number carries the customer through curing so the smokehouse knows whose
-- piece it is and how their cut sheet says to finish it.
-- Purely additive — touches no existing tables.

-- A roll of seals as received: registering the printed number range is what
-- lets the scanner tell a seal barcode apart from a mistyped PLU.
CREATE TABLE IF NOT EXISTS cure_tag_rolls (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  start_number bigint      NOT NULL,
  end_number   bigint      NOT NULL,
  digits       int         NOT NULL,   -- printed length incl. leading zeros ("0036013" = 7)
  note         text,
  CHECK (end_number >= start_number)
);

CREATE TABLE IF NOT EXISTS cure_tags (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),         -- when it was tagged in
  tag_number    text        NOT NULL UNIQUE,       -- as printed/scanned, incl. leading zeros
  product       text        NOT NULL,              -- Ham | Bacon | Shoulder Bacon | Hocks | Jowl | Other
  customer_name text        NOT NULL,              -- snapshot from the scanner session
  session_date  date,
  weight_lbs    numeric,
  status        text        NOT NULL DEFAULT 'curing' CHECK (status IN ('curing','done')),
  completed_at  timestamptz,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_cure_tags_status   ON cure_tags(status);
CREATE INDEX IF NOT EXISTS idx_cure_tags_customer ON cure_tags(customer_name);
