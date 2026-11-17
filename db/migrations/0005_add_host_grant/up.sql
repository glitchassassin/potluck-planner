ALTER TABLE accounts ADD COLUMN has_host_grant INTEGER NOT NULL DEFAULT 0
  CHECK (has_host_grant IN (0, 1));
