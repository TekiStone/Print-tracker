CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('printing', 'ready', 'offline', 'error')),
  current_job TEXT,
  progress SMALLINT CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100)),
  color TEXT NOT NULL DEFAULT '#f27852',
  prusalink_url TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  material TEXT NOT NULL,
  color TEXT NOT NULL,
  initial_grams INTEGER NOT NULL CHECK (initial_grams > 0),
  remaining_grams INTEGER NOT NULL CHECK (remaining_grams >= 0 AND remaining_grams <= initial_grams),
  location TEXT,
  qr_url TEXT,
  prusament_id TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  spool_id UUID REFERENCES spools(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('queued', 'printing', 'completed', 'failed', 'cancelled')),
  filament_grams INTEGER CHECK (filament_grams IS NULL OR filament_grams >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
