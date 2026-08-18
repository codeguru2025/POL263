-- IFRS 17 measurement-model classification per product version. Nullable/additive — every
-- existing product version stays null (unclassified) until a tenant's own auditor explicitly
-- sets it via the product-version form; nothing reads this column until
-- server/insurance-revenue.ts ships, so leaving it null is safe/inert. Values (validated at the
-- route layer, plain text per this schema's existing enum-like-column convention): 'paa' | 'gmm'
-- | 'vfa' | 'out_of_scope'.
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS measurement_approach text;
