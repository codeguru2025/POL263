-- Inception date: set when first payment is received (issue date).
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "inception_date" date;
