-- Notification enhancements: read tracking, policy linking
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS read_at timestamp,
  ADD COLUMN IF NOT EXISTS policy_id uuid;

CREATE INDEX IF NOT EXISTS nl_read_idx ON notification_logs (recipient_id, read_at);
CREATE INDEX IF NOT EXISTS nl_policy_idx ON notification_logs (policy_id);
