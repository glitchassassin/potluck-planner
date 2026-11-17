DROP TABLE sign_in_limits;
ALTER TABLE auth_flows ADD COLUMN return_path TEXT NOT NULL DEFAULT '/';
