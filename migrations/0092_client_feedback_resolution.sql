-- IPEC compliance review (2026-07-26): client_feedback (complaints/feedback inbox) had a status
-- but no record of what was actually done to resolve a complaint, who did it, or whether it was
-- escalated — a named consumer-protection gap. Mirrors claims' existing aging/SLA treatment
-- (server/claims-sla.ts) rather than a new pattern. Additive/nullable except `escalated`, which
-- defaults false so every existing row reads as "not escalated" (accurate — escalation didn't
-- exist before this).

ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS resolved_at timestamp;
ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS resolution_notes text;
ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid REFERENCES users(id);
ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;
ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS escalated_at timestamp;
ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS escalated_to_user_id uuid REFERENCES users(id);
