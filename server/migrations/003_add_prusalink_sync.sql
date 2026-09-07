ALTER TABLE printers ADD COLUMN IF NOT EXISTS prusalink_api_key TEXT;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS prusalink_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS nozzle_temperature REAL;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS nozzle_target_temperature REAL;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS bed_temperature REAL;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS bed_target_temperature REAL;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS prusalink_version TEXT;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS external_job_path TEXT;

ALTER TABLE print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_source_check;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_source_check
  CHECK (source IN ('manual', 'prusalink'));

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_prusalink_active_unique
  ON print_jobs (printer_id, external_job_path)
  WHERE source = 'prusalink' AND completed_at IS NULL AND external_job_path IS NOT NULL;
