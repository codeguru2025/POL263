-- Deceased identity fields for funeral cases. For policy-claim cases these are
-- auto-populated from the selected covered member; for cash cases they are entered
-- manually. Uses IF NOT EXISTS so re-running against a DB that already received
-- these columns via db:push is safe.

ALTER TABLE funeral_cases
  ADD COLUMN IF NOT EXISTS deceased_dob           date,
  ADD COLUMN IF NOT EXISTS deceased_gender        text,
  ADD COLUMN IF NOT EXISTS deceased_national_id   text,
  ADD COLUMN IF NOT EXISTS deceased_relationship  text;
