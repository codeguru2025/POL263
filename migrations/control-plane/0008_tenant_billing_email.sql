-- A single designated address for all POL263 billing correspondence to a tenant (invoices,
-- receipts, dunning). When null, billing emails fall back to every administrator-role user, as
-- before.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email text;
