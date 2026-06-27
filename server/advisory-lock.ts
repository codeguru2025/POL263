import { pool } from "./db";
import { structuredLog } from "./logger";

/**
 * Acquires a session-level PostgreSQL advisory lock for the duration of `fn`.
 * If the lock is already held by another session, returns immediately without calling `fn`.
 * Uses the two-argument form so callers can combine a namespace class with a per-entity key.
 */
export async function withAdvisoryLock(
  lockKey: number,
  fn: () => Promise<void>,
): Promise<void>;
export async function withAdvisoryLock(
  lockClass: number,
  lockKey: number,
  fn: () => Promise<void>,
): Promise<void>;
export async function withAdvisoryLock(
  lockClassOrKey: number,
  lockKeyOrFn: number | (() => Promise<void>),
  maybeFn?: () => Promise<void>,
): Promise<void> {
  const isTwoArg = typeof lockKeyOrFn === "function";
  const fn = isTwoArg ? (lockKeyOrFn as () => Promise<void>) : maybeFn!;
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    let rows: { ok: boolean }[];
    if (isTwoArg) {
      ({ rows } = await lockClient.query(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [lockClassOrKey],
      ) as any);
    } else {
      ({ rows } = await lockClient.query(
        "SELECT pg_try_advisory_lock($1, $2) AS ok",
        [lockClassOrKey, lockKeyOrFn as number],
      ) as any);
    }
    lockAcquired = rows[0]?.ok === true;
    if (!lockAcquired) return;
    await fn();
  } catch (err: any) {
    structuredLog("error", "withAdvisoryLock: fn threw", { error: err?.message });
    throw err;
  } finally {
    if (lockAcquired) {
      try {
        if (isTwoArg) {
          await lockClient.query("SELECT pg_advisory_unlock($1)", [lockClassOrKey]);
        } else {
          await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [lockClassOrKey, lockKeyOrFn as number]);
        }
      } catch {}
    }
    lockClient.release();
  }
}
