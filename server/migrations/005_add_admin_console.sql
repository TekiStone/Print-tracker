CREATE TABLE IF NOT EXISTS app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  registration_enabled BOOLEAN NOT NULL DEFAULT true,
  local_login_enabled BOOLEAN NOT NULL DEFAULT true,
  authentik_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
