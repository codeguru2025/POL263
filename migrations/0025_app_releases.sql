-- Migration: app_releases table
-- Tracks APK releases, min version enforcement, and download URLs.

CREATE TABLE IF NOT EXISTS "app_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" text NOT NULL,
  "build_number" integer NOT NULL,
  "min_version" text NOT NULL DEFAULT '1.0.0',
  "min_build_number" integer NOT NULL DEFAULT 1,
  "download_url" text NOT NULL,
  "release_notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "app_releases_active_idx" ON "app_releases" ("is_active", "created_at");
