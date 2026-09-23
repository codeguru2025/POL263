-- Dynamic ("individual age-rated") pricing engine — opt-in per product via pricing_model.
--
-- Today's only behavior ('bundled_family') is untouched: a flat product_versions.premiumMonthly*
-- base covers up to maxAdults/maxChildren/maxExtendedMembers members for free, and anyone beyond
-- that is surcharged via product_versions.additionalMemberRate*. Existing products default to
-- 'bundled_family' and see zero behavior change from this migration.
--
-- 'individual_age_rated' prices every covered life (policyholder included) individually, from
-- age_band_rate_cards, against their own effective cover amount (products.coverAmount by default,
-- overridable per policy_member up to the policyholder's own cover). See computePolicyPremium in
-- server/route-helpers.ts.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pricing_model TEXT NOT NULL DEFAULT 'bundled_family';

CREATE TABLE IF NOT EXISTS age_band_rate_cards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  product_version_id uuid NOT NULL REFERENCES product_versions(id),
  age_band           text NOT NULL,
  currency           text NOT NULL,
  rate_per_thousand  numeric(10, 4) NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abrc_pv_idx ON age_band_rate_cards (product_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS abrc_pv_band_currency_idx ON age_band_rate_cards (product_version_id, age_band, currency);

ALTER TABLE policy_members
  ADD COLUMN IF NOT EXISTS cover_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS premium_contribution NUMERIC;

ALTER TABLE add_ons
  ADD COLUMN IF NOT EXISTS cover_increment_amount NUMERIC;
