-- Age-band-specific rates for additional (paying) members, on top of the flat
-- additional_member_premium_monthly_usd/zar rate already on product_versions.
-- All columns are nullable: existing product versions are left with none of
-- these set, so their pricing is completely unaffected — computePolicyPremium
-- falls back to the flat rate/legacy underwriter rates whenever no band rate
-- is configured for a version. The "child" band uses the version's own
-- dependent_max_age cutoff (already stored); these four columns cover the
-- age ranges beyond that: 21-65, 66-84, and 85+.

ALTER TABLE product_versions
  ADD COLUMN IF NOT EXISTS additional_member_rate_child_usd numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_child_zar numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_21_65_usd numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_21_65_zar numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_66_84_usd numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_66_84_zar numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_85_plus_usd numeric,
  ADD COLUMN IF NOT EXISTS additional_member_rate_85_plus_zar numeric;
