-- Multi-currency support: add currency column to cashups and claims
ALTER TABLE cashups
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
