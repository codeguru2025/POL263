-- Durable "this job already ran for this key" marker (server/scheduler-claims.ts). Needed because
-- production runs 2 app instances: an in-memory "already ran today" map only knows about its own
-- instance, so each instance sent the daily client-notification batch (duplicate SMS).
-- The PRIMARY KEY makes the claim atomic: exactly one INSERT wins.
CREATE TABLE IF NOT EXISTS scheduler_run_claims (
  job text NOT NULL,
  run_key text NOT NULL,
  claimed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (job, run_key)
);
