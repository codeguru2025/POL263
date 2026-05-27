/**
 * One-shot script to register a specific APK build in the app_releases table.
 * Usage: npx tsx script/register-apk-release.ts
 */
import { db } from "../server/db";
import { appReleases } from "../shared/schema";
import { eq } from "drizzle-orm";

const RELEASE = {
  version: "1.0.0",
  buildNumber: 12,
  minVersion: "1.0.0",
  minBuildNumber: 1,
  downloadUrl: "https://expo.dev/artifacts/eas/vPnTH4CRwFFSHxBjZ6th2L.apk",
  releaseNotes: "First production release — Expo SDK 56, Gradle 8.13, React Native 0.85.3",
  isActive: true,
};

async function main() {
  console.log("Deactivating any existing active releases...");
  await db.update(appReleases).set({ isActive: false }).where(eq(appReleases.isActive, true));

  console.log("Inserting new release:", RELEASE.version, `(build ${RELEASE.buildNumber})`);
  const [row] = await db.insert(appReleases).values(RELEASE).returning();
  console.log("Registered:", row.id, "→", row.downloadUrl);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
