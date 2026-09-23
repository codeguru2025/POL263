-- A payment link auto-created at self-registration (no staff choosing a method up front) has no
-- method yet — the payer picks one on the public /api/pay/:token/initiate call. Staff-created
-- links (POST /api/policies/:id/payment-links) still always set one; this only relaxes the
-- constraint for the new auto-created case.
ALTER TABLE payment_links ALTER COLUMN method DROP NOT NULL;
