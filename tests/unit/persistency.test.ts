import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { cohortFigures } from "../../server/persistency";

describe("cohortFigures", () => {
  it("never paid counts against take-up, not persistency", () => {
    // Falakhe, July 2026: 66 sold, 33 never paid, 25 in force, 8 lapsed
    const c = cohortFigures("2026-07", 3, { inactive: 33, active: 23, grace: 2, lapsed: 8 });
    expect(c).toMatchObject({ sold: 66, neverPaid: 33, notTakenUpPct: 50, startedPaying: 33, inForce: 25, lapsed: 8, persistencyPct: 75.8 });
  });
  it("a month where nobody paid has no persistency figure", () => {
    expect(cohortFigures("2026-05", 5, { inactive: 9 }).persistencyPct).toBeNull();
  });
});
