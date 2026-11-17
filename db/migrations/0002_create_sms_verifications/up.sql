create table sms_verifications (
  phone_e164 text not null primary key,
  verification_sid text,
  expires_at integer,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  next_send_at integer not null default 0,
  operation_id text,
  operation_expires_at integer not null default 0
) strict;
