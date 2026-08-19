-- Per-tenant national ID format, replacing the previously hardcoded Zimbabwe-shaped regex
-- (digits + one letter + two digits) used for every tenant regardless of country. The value is a
-- key into the curated NATIONAL_ID_FORMATS catalog in shared/validation.ts (not a free-text regex
-- an admin could author — avoids ReDoS/correctness risk from untrusted patterns).
-- Defaults every existing org to 'zimbabwe' so behavior is byte-identical to before this column
-- existed; a tenant operating elsewhere (or one that just wants a free-text identifier, via the
-- 'none' catalog entry) can change it via Settings.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS national_id_format text NOT NULL DEFAULT 'zimbabwe';
