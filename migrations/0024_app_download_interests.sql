-- 0024: App download interest registrations (platform-level, not org-scoped)
-- Captures name + email of visitors who click the App Store / Play Store badges on the login screen.
-- Apply with: npm run db:migrate   |   Status: npm run db:migrate:status
CREATE TABLE IF NOT EXISTS app_download_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  platform text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_dl_created_idx ON app_download_interests (created_at DESC);
