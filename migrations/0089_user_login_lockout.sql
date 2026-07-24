-- DB-backed lockout for staff/agent login (mirrors clients.failed_login_attempts/locked_until),
-- replacing the in-memory-per-process agent lockout in server/auth.ts, which was not safe under
-- horizontal scaling (each instance tracked its own counter). Additive, nullable/defaulted —
-- every existing user simply starts unlocked with zero recorded failures.

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamp;
