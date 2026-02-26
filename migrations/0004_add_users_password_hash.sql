-- Add password_hash for agent login (username/password). Staff use Google OAuth.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
