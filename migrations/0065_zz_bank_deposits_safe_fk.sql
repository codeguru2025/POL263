-- Companion to 0004_baseline_missing_tables.sql: bank_deposits.safe_id needs a foreign key to
-- "safes", but "safes" isn't created until 0065_safes.sql (this file is named to sort right
-- after it: "0065_safes.sql" < "0065_zz_..." < "0066_..."). See 0004_baseline_missing_tables.sql
-- for the full explanation of why this couldn't be a single insertion point.

ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_safe_id_safes_id_fk" FOREIGN KEY ("safe_id") REFERENCES "public"."safes"("id") ON DELETE no action ON UPDATE no action;
