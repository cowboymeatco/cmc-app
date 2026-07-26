-- Run this in Supabase Dashboard → SQL Editor
-- Creates the cook_session and cook_reading tables for the ThermoWorks cook log.

CREATE TABLE IF NOT EXISTS cook_session (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  session_name  text        NOT NULL,
  device_serial text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  target_temp_f numeric,
  product       text,
  notes         text,
  status        text        DEFAULT 'active'
                            CHECK (status IN ('active', 'complete'))
);

CREATE TABLE IF NOT EXISTS cook_reading (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  session_id    uuid        REFERENCES cook_session(id) ON DELETE CASCADE,
  device_serial text,
  read_at       timestamptz NOT NULL,
  channel       int         NOT NULL,
  channel_label text,
  temp_f        numeric
);

CREATE INDEX IF NOT EXISTS idx_cook_reading_session ON cook_reading(session_id);
CREATE INDEX IF NOT EXISTS idx_cook_reading_read_at ON cook_reading(read_at DESC);

-- Also add a source column to cold_storage_log so auto vs. manual entries are visible
ALTER TABLE cold_storage_log
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
