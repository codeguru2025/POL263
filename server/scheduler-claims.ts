/**
 * Durable once-only claims for scheduled work (table scheduler_run_claims, migration 0128).
 *
 * The advisory lock (server/advisory-lock.ts) stops two instances running a job AT THE SAME TIME;
 * this stops the same logical run happening TWICE at all — e.g. instance B's timer firing just
 * after instance A finished, or a manual "run now" after the scheduled run already went out.
 * Lives on the shared registry DB (one table for every tenant), keyed by job + run key
 * (typically "<orgId>:<YYYY-MM-DD>").
 */
import { pool } from "./db";

/** True if this caller won the claim (first ever for job+runKey); false if already claimed. */
export async function claimSchedulerRun(job: string, runKey: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "INSERT INTO scheduler_run_claims (job, run_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [job, runKey],
  );
  return (rowCount ?? 0) > 0;
}

