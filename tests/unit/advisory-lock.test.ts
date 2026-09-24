import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression guard for 2026-09-24: production's DATABASE_URL is a PgBouncer pool in transaction
// mode, where a SESSION advisory lock isn't exclusive — both app instances ran every sweep (duplicate
// SMS, duplicate grace transitions). The lock must be a transaction-level one held in an open txn.
const h = vi.hoisted(() => ({ queries: [] as string[], lockResult: true }));
vi.mock("../../server/db", () => ({
  pool: {
    connect: async () => ({
      query: async (text: string) => {
        h.queries.push(text);
        if (text.includes("pg_try_advisory")) return { rows: [{ ok: h.lockResult }] };
        return { rows: [] };
      },
      release: () => h.queries.push("RELEASE_CLIENT"),
    }),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { withAdvisoryLock } from "../../server/advisory-lock";

describe("withAdvisoryLock", () => {
  beforeEach(() => { h.queries = []; h.lockResult = true; });

  it("holds a transaction-level lock inside BEGIN…COMMIT around fn — never a session lock", async () => {
    const fn = vi.fn(async () => { h.queries.push("FN"); });
    await withAdvisoryLock(9_002_630_005, fn);
    expect(h.queries).toEqual([
      "BEGIN", "SELECT pg_try_advisory_xact_lock($1::bigint) AS ok", "FN", "COMMIT", "RELEASE_CLIENT",
    ]);
    expect(h.queries.some((q) => /pg_try_advisory_lock\(|pg_advisory_unlock/.test(q))).toBe(false);
  });

  it("skips fn and closes the transaction when another holder has the lock", async () => {
    h.lockResult = false;
    const fn = vi.fn();
    await withAdvisoryLock(1, 2, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(h.queries).toContain("ROLLBACK");
    expect(h.queries.at(-1)).toBe("RELEASE_CLIENT");
  });

  it("still releases (COMMIT + client) when fn throws", async () => {
    await expect(withAdvisoryLock(5, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(h.queries.slice(-2)).toEqual(["COMMIT", "RELEASE_CLIENT"]);
  });
});
