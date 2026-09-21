-- Lets a case_service_charge be priced from the add-ons catalogue (add_ons.coverIncrementAmount)
-- instead of the mortuary rate card, for the "same cash value, three contexts" model: raises sum
-- assured/premium at join/quote (already supported via pricingMode 'cover_topup'), a discounted
-- charge here when a policyholder picks a benefit outside their policy, or a full-price charge
-- here for a walk-in with no policy at all.
ALTER TABLE case_service_charges
  ADD COLUMN IF NOT EXISTS add_on_id UUID REFERENCES add_ons(id);
