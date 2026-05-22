/**
 * Manually trigger the backup sync from DO → Supabase.
 * Usage: npx tsx script/run-backup-sync.ts
 */
import "dotenv/config";
import { runBackupSync } from "../server/backup-sync";

console.log("Starting backup sync from DO → Supabase...\n");
await runBackupSync();
console.log("\nDone.");
process.exit(0);
