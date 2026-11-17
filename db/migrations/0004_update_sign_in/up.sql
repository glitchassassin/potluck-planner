ALTER TABLE auth_flows DROP COLUMN return_path;

CREATE TABLE sign_in_limits (
  ip_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('send', 'check')),
  attempts INTEGER NOT NULL,
  resets_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, action)
) STRICT;
CREATE INDEX sign_in_limits_expiry ON sign_in_limits (resets_at);
