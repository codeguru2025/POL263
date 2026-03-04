-- Ensure org_policy_sequences exists (used for receipt numbers). Created by drizzle push; this migration backs environments that only run migrations.
CREATE TABLE IF NOT EXISTS org_policy_sequences (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  policy_next integer NOT NULL DEFAULT 1,
  receipt_next integer NOT NULL DEFAULT 0,
  payment_receipt_next integer NOT NULL DEFAULT 0,
  claim_next integer NOT NULL DEFAULT 0,
  case_next integer NOT NULL DEFAULT 0
);

-- Add payment_receipt_next if table existed from an older schema without it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_policy_sequences')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'org_policy_sequences' AND column_name = 'payment_receipt_next') THEN
    ALTER TABLE org_policy_sequences ADD COLUMN payment_receipt_next integer NOT NULL DEFAULT 0;
  END IF;
END $$;
