-- Rename chibikhulu_receivables table to platform_receivables
ALTER TABLE IF EXISTS chibikhulu_receivables RENAME TO platform_receivables;

-- Rename the old index to match the new table name
ALTER INDEX IF EXISTS cr_org_idx RENAME TO pr_recv_org_idx;

-- Update settlement_allocations FK column reference (no rename needed — FK references are by OID, not name)
-- The foreign key constraint itself references the table by OID so the rename is transparent.
