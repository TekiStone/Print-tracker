ALTER TABLE users
  ALTER COLUMN oidc_subject DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
