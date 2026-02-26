/**
 * Run database seed from the command line.
 * Usage: npm run db:seed (from project root)
 * Requires .env with DATABASE_URL and schema already pushed (npm run db:push).
 */
import "dotenv/config";
import { seedDatabase } from "../server/seed";

seedDatabase()
  .then(() => {
    console.log("Seed finished successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
