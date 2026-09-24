import type { PoolClient } from "pg";
import { pool } from "./db";
import { structuredLog } from "./logger";

/**
 * Runs `fn` only if this process wins a PostgreSQL advisory lock; if another process holds it,
 * returns immediately without calling `fn`. Uses the two-argument form when given a namespace
 * class plus a per-entity key.
 *
 * TRANSACTION-level lock (pg_try_advisory_xact_lock inside an open transaction), not session-
 * level. DATABASE_URL points at DigitalOcean's PgBouncer pool in *transaction* mode: a session
 * lock taken there isn't pinned to this client — PgBouncer hands the underlying server connection
 * to other clients between statements, and advisory locks are re-entrant within a server session,
 * so a second app instance could "acquire" the very same lock. With two instances running (the
 * production app scaled to 2 on 2026-09-20), every scheduled sweep ran twice: duplicate SMS,
 * duplicate status-history rows. PgBouncer pins one server connection for a whole transaction,
 * so a transaction-level lock held for the duration of `fn` is exclusive, and it is released
 * automatically (COMMIT/ROLLBACK, or the connection dropping) — it can never leak.
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
  const singleKey = typeof lockKeyOrFn === "function";
  const fn = singleKey ? (lockKeyOrFn as () => Promise<void>) : maybeFn!;
  const keys = singleKey ? [lockClassOrKey] : [lockClassOrKey, lockKeyOrFn as number];
  const lockClient = await pool.connect();
  try {
    const acquired = await tryXactLock(lockClient, keys);
    if (!acquired) return;
    try {
      await fn();
    } catch (err: any) {
      structuredLog("error", "withAdvisoryLock: fn threw", { error: err?.message });
      throw err;
    }
  } finally {
    await endXactLock(lockClient);
    lockClient.release();
  }
}

/** BEGIN + pg_try_advisory_xact_lock on `client`. On false the transaction is already closed. */
export async function tryXactLock(client: PoolClient, keys: number[]): Promise<boolean> {
  await client.query("BEGIN");
  const sqlText = keys.length === 1
    ? "SELECT pg_try_advisory_xact_lock($1::bigint) AS ok"
    : "SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS ok";
  const { rows } = await client.query(sqlText, keys);
  if (rows[0]?.ok === true) return true;
  await client.query("ROLLBACK").catch(() => {});
  return false;
}

/** Ends the lock-holding transaction (releases the lock). Safe to call when none is open. */
export async function endXactLock(client: PoolClient): Promise<void> {
  await client.query("COMMIT").catch(() => {});
}
