ALTER TABLE printers ADD COLUMN IF NOT EXISTS active_spool_id UUID REFERENCES spools(id) ON DELETE SET NULL;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS active_spool_assigned_at TIMESTAMPTZ;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS estimated_filament_grams INTEGER;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS filament_applied_at TIMESTAMPTZ;
