import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { statusAt, durationBucket } from "../../server/lapse-analysis";

const d = (s: string) => new Date(s + "T10:00:00Z");

describe("statusAt — a policy's status at a moment, from its history", () => {
  const events = [
    { from: null, to: "inactive", at: d("2026-06-01") },
    { from: "inactive", to: "active", at: d("2026-06-05") },
    { from: "active", to: "grace", at: d("2026-08-10") },
    { from: "grace", to: "lapsed", at: d("2026-09-10") },
  ];
  it("the last change before the moment", () => {
    expect(statusAt(events, d("2026-06-01"), "lapsed", d("2026-07-01"))).toBe("active");
    expect(statusAt(events, d("2026-06-01"), "lapsed", d("2026-09-01"))).toBe("grace");
    expect(statusAt(events, d("2026-06-01"), "lapsed", d("2026-10-01"))).toBe("lapsed");
  });
  it("not yet created → null; no history at all → current status", () => {
    expect(statusAt(events, d("2026-06-01"), "lapsed", d("2026-05-01"))).toBeNull();
    expect(statusAt([], d("2026-03-01"), "active", d("2026-07-01"))).toBe("active");
  });
  it("before its first recorded change, the status that change came from", () => {
    expect(statusAt([{ from: "active", to: "grace", at: d("2026-08-10") }], d("2026-03-01"), "grace", d("2026-07-01"))).toBe("active");
  });
});

describe("durationBucket", () => {
  it("months of cover before the lapse", () => {
    expect(durationBucket("2026-07-15", "2026-09-10")).toBe("0–3 months");
    expect(durationBucket("2026-03-01", "2026-09-10")).toBe("4–6 months");
    expect(durationBucket("2025-06-01", "2026-09-10")).toBe("over 12 months");
    expect(durationBucket(null, "2026-09-10")).toBe("unknown");
  });
});
