CREATE TABLE auth_flows (
  token_hash TEXT PRIMARY KEY NOT NULL,
  phone_e164 TEXT NOT NULL,
  return_path TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_flows_expiry ON auth_flows (expires_at);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_sessions_expiry ON auth_sessions (expires_at);
CREATE INDEX auth_sessions_account ON auth_sessions (account_id);
