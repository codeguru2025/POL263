import { describe, it, expect, vi } from "vitest";
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
import { stripSslMode } from "../../server/backup-sync";

// 2026-09-24: sslmode=require in SUPABASE_BACKUP_URL made pg verify-full, overriding
// rejectUnauthorized:false — every nightly backup copied 0 rows for weeks.
describe("stripSslMode", () => {
  it("removes sslmode wherever it sits, keeps other params", () => {
    expect(stripSslMode("postgres://u@h:6543/db?sslmode=require")).toBe("postgres://u@h:6543/db");
    expect(stripSslMode("postgres://u@h/db?x=1&sslmode=require")).toBe("postgres://u@h/db?x=1");
    expect(stripSslMode("postgres://u@h/db?sslmode=verify-full&x=1")).toBe("postgres://u@h/db?x=1");
    expect(stripSslMode("postgres://u@h/db")).toBe("postgres://u@h/db");
  });
});
