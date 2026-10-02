import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { rankScorecard, NO_AGENT, type ScorecardRow } from "../../server/agent-productivity";

const row = (o: Partial<ScorecardRow>): ScorecardRow => ({
  rank: null, agentId: "a", agent: "A", newSold: 0, paid: 0, notPaid: 0, conversionPct: null, newMonthlyPremium: {}, avgPremiumUsd: null, avgLives: null,
  typedIn: 0, collected: {}, lapses: 0, persistencyPct: null, recentSold: 0, recentNotStuck: 0, commissionEarned: {}, clawedBack: {}, commissionPctOfCollected: null, ...o,
});

describe("rankScorecard", () => {
  const fx = { USD: 1, ZAR: 0.05 };
  it("ranks agents who sold by new premium in USD; others and 'no agent' are unranked and last", () => {
    const out = rankScorecard([
      row({ agentId: null, agent: NO_AGENT, newSold: 12, newMonthlyPremium: { USD: "500.00" } }),
      row({ agentId: "b", agent: "B", newSold: 2, newMonthlyPremium: { ZAR: "400.00" } }),   // USD 20
      row({ agentId: "c", agent: "C", newSold: 0, collected: { USD: "100.00" } }),
      row({ agentId: "d", agent: "D", newSold: 3, newMonthlyPremium: { USD: "36.00" } }),
    ], fx);
    expect(out.map((r) => [r.agent, r.rank])).toEqual([["D", 1], ["B", 2], ["C", null], [NO_AGENT, null]]);
  });
});
