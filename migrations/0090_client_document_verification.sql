-- KYC review status on uploaded client documents (ID copies, proof of address, etc). Every
-- document previously had no verification concept at all — staff could see it was uploaded but
-- never record whether anyone had actually checked it. Additive/nullable: every existing document
-- starts "pending" (unreviewed), matching reality.

ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending';
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id);
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS verified_at timestamp;
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS rejection_reason text;
