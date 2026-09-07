ALTER TABLE spools ADD COLUMN IF NOT EXISTS qr_url TEXT;
ALTER TABLE spools ADD COLUMN IF NOT EXISTS prusament_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS spools_prusament_id_unique
  ON spools (prusament_id)
  WHERE prusament_id IS NOT NULL AND archived_at IS NULL;
