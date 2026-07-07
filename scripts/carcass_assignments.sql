-- Run this in Supabase Dashboard → SQL Editor (project eosafbzqitgqzhejilhf).
-- Records which physical carcass (and which split PORTION of it) belongs to which
-- cut customer on a harvest appointment. Purely additive — touches no existing data.
--
-- One row per (carcass × customer). A whole carcass = 1 row (portion 'Whole').
-- A carcass split between two buyers = 2 rows (portion 'Half' each). Etc.
-- The Cut Schedule reads these to show one cut job per assigned portion; carcasses
-- with NO rows here fall back to the interim one-row-per-carcass behaviour.

CREATE TABLE IF NOT EXISTS carcass_assignments (
  id                            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at                    timestamptz DEFAULT now(),
  harvest_log_id                uuid        NOT NULL REFERENCES harvest_log(id) ON DELETE CASCADE,  -- harvest_log.id is uuid
  appointment_id                text,                  -- harvest_appointments.id is TEXT (e.g. 'e03872a9')
  appointment_customer_id       text        NOT NULL,  -- = customer.id inside harvest_appointments.customers jsonb
  customer_name                 text,                  -- snapshot, so display survives appointment edits
  portion                       text        NOT NULL
                                            CHECK (portion IN ('Whole','Half','Quarter')),
  linked_cutting_instruction_id text,                  -- cutting_instructions.id is TEXT; snapshot of the customer's cut sheet
  -- a given carcass can be assigned to a given customer only once
  UNIQUE (harvest_log_id, appointment_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_carcass_assign_log  ON carcass_assignments(harvest_log_id);
CREATE INDEX IF NOT EXISTS idx_carcass_assign_appt ON carcass_assignments(appointment_id);
