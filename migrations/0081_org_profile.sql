-- Tenant business-profile fields captured at onboarding — drive which product builder(s),
-- claims workflow, nav items, and report sections a tenant sees. All nullable/additive:
-- existing tenants (created before this existed) get NULL orgType until explicitly backfilled.
-- The capability resolver must treat "no profile" as "show everything" (fail open), never as
-- "show nothing" — see server/org-capabilities.ts.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_type text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS product_types jsonb NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS distribution_channels jsonb NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS book_status text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS book_size_current integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS book_size_projected_12mo integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS staff_complement integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_profile_completed_at timestamp;
