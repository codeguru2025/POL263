-- Per-message SMS log backing the tenant SMS usage report (shared/schema.ts smsMessages), plus a
-- durable retry marker on notification_logs so an SMS that failed for a temporary reason
-- (provider down, sending paused, allowance used up) is retried instead of silently dropped.
CREATE TABLE IF NOT EXISTS sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  recipient text NOT NULL,
  client_id uuid,
  message text NOT NULL,
  segments integer NOT NULL DEFAULT 1,
  credits_charged integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'transactional',
  source text NOT NULL DEFAULT 'other',
  event_type text,
  status text NOT NULL,
  failure_reason text,
  provider_message_id text,
  notification_log_id uuid,
  sent_by_user_id uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_org_created_idx ON sms_messages (organization_id, created_at);

ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
CREATE INDEX IF NOT EXISTS notification_logs_sms_retry_idx ON notification_logs (next_retry_at) WHERE next_retry_at IS NOT NULL;
