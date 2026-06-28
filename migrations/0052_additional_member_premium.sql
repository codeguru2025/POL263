-- Add client-facing per-additional-member premium rates to product_versions.
-- These are charged on top of the base premium for each member that exceeds
-- the product's included count (maxAdults + maxChildren + maxExtendedMembers).

ALTER TABLE product_versions
  ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_usd numeric,
  ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_zar numeric;
