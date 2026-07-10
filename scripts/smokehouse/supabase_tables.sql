-- Run this in Supabase Dashboard → SQL Editor
-- Creates the smokehouse_cook and smokehouse_reading tables for the
-- Enviro-Pak smokehouse (FDC-2110i HMI) data-log ingestion.

CREATE TABLE IF NOT EXISTS smokehouse_cook (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  file_name   text        NOT NULL UNIQUE,
  oven        text        NOT NULL DEFAULT 'Oven1',
  batch       text,
  truck       text,
  operator    text,
  started_at  timestamptz,
  ended_at    timestamptz,
  row_count   int
);

CREATE TABLE IF NOT EXISTS smokehouse_reading (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  cook_id       uuid        REFERENCES smokehouse_cook(id) ON DELETE CASCADE,
  oven          text        NOT NULL,
  read_at       timestamptz NOT NULL,
  dry_bulb_f    numeric,
  dry_bulb_sp_f numeric,
  rh_pct        numeric,
  rh_sp_pct     numeric,
  core_f        numeric,
  damper_pct    numeric,
  UNIQUE (oven, read_at)
);

CREATE INDEX IF NOT EXISTS idx_smokehouse_reading_cook    ON smokehouse_reading(cook_id);
CREATE INDEX IF NOT EXISTS idx_smokehouse_reading_read_at ON smokehouse_reading(read_at DESC);
