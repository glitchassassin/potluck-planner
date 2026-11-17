CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  verified_phone_number TEXT NOT NULL UNIQUE CHECK (
    length(verified_phone_number) = 12
    AND substr(verified_phone_number, 1, 2) = '+1'
    AND substr(verified_phone_number, 3) NOT GLOB '*[^0-9]*'
  ),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;
