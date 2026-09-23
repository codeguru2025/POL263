-- add_ons had no currency field at all — coverIncrementAmount/priceAmount/etc. were implicitly
-- assumed USD everywhere that read them. Defaults every existing add-on to "USD" (matches actual
-- practice for every tenant that already has add-ons) while letting a non-USD tenant set it
-- explicitly going forward.
ALTER TABLE add_ons
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
