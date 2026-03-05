-- Product versions: weekly and biweekly premium in ZAR (Rands) for payment schedule options
ALTER TABLE product_versions
  ADD COLUMN IF NOT EXISTS premium_weekly_zar numeric,
  ADD COLUMN IF NOT EXISTS premium_biweekly_zar numeric;
