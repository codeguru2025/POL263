-- Migration 0039: Track accumulated grace days used per policy

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS grace_used_days INTEGER NOT NULL DEFAULT 0;
