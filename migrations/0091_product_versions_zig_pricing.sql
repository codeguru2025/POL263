-- ZiG (Zimbabwe Gold) is already a first-class currency everywhere else in the app (fx_rates,
-- receipts, debit orders, groups) but product_versions never got a ZiG column alongside its
-- USD/ZAR pricing pairs — a product literally could not be priced in ZiG. Additive/nullable,
-- same as every other currency-pair column here: a version with no ZiG price set just doesn't
-- offer ZiG, matching today's behavior exactly.

ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS premium_monthly_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS premium_weekly_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS premium_biweekly_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_rate_child_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_rate_21_65_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_rate_66_84_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_rate_85_plus_zig numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS daily_benefit_rate_zig numeric;
