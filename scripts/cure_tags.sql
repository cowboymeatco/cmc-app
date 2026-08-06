-- Applied 2026-07-30 (Supabase migration `cure_tags`); cure_tag_rolls dropped
-- 2026-08-06 (`drop_cure_tag_rolls`) — recognition is by digit shape now
-- (7 digits, leading zero — see isCureTagNumber in lib/types.ts), so seal
-- rolls no longer need registering. Kept here as documentation.
--
-- Cure tags: numbered tamper seals (LeadSeals barcode zip-ties) attached to
-- hams/bacons on the cut floor before they go to the cure cooler. The seal
-- number carries the customer through curing so the smokehouse knows whose
-- piece it is and how their cut sheet says to finish it.

CREATE TABLE IF NOT EXISTS cure_tags (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),         -- when it was tagged in
  tag_number    text        NOT NULL UNIQUE,       -- as printed/scanned, incl. leading zeros
  product       text        NOT NULL,              -- Ham | Bacon | Shoulder Bacon | Bone-In Loin | Hocks | Jowl | Other
  customer_name text        NOT NULL,              -- snapshot from the scanner session
  session_date  date,
  weight_lbs    numeric,
  status        text        NOT NULL DEFAULT 'curing' CHECK (status IN ('curing','done')),
  completed_at  timestamptz,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_cure_tags_status   ON cure_tags(status);
CREATE INDEX IF NOT EXISTS idx_cure_tags_customer ON cure_tags(customer_name);
