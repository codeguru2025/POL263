-- Add max_additional_members to products.
-- Null means unlimited additional members are allowed.
-- A positive integer caps how many extra members beyond the included count may be added.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS max_additional_members integer;
