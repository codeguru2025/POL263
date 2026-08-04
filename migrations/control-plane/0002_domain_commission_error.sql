-- Records why automated tenant-domain commissioning failed (DNS record step or DO App
-- Platform domain-list step), so a stuck tenant is visible with a reason instead of just
-- domain_commissioned staying false with no explanation. See server/do-app-domains.ts and
-- docs/BUGFIX-LOG.md, 2026-08-04 domain automation entry.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_commission_error text;
