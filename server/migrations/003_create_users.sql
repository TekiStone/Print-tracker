CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_subject TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  picture_url TEXT,
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
