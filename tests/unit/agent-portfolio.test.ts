import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { summarizePortfolio, NO_AGENT_TYPED_IN, NO_AGENT_WALK_IN, type PortfolioPolicy } from "../../server/agent-portfolio";

const pol = (o: Partial<PortfolioPolicy>): PortfolioPolicy => ({
  agent: "A", policyNumber: "P", status: "active", firstName: "", lastName: "", nationalId: "", phone: "", product: "", branch: "", group: "",
  currency: "USD", premium: "10.00", schedule: "monthly", inceptionDate: null, paidUpTo: null, periodsBehind: 0, amountBehind: "0.00",
  lastPaymentDate: null, lastPaymentAmount: null, lastPaymentCurrency: null, isLegacy: false, ...o,
});

describe("summarizePortfolio", () => {
  it("counts by status, premium in force as monthly per currency, behind only on live policies", () => {
    const [a] = summarizePortfolio([
      pol({}),
      pol({ status: "grace", schedule: "weekly", premium: "3.00", periodsBehind: 1 }),
      pol({ status: "lapsed", periodsBehind: 2 }),
      pol({ status: "inactive" }),
      pol({ currency: "ZAR", premium: "120.00" }),
    ]);
    expect(a).toMatchObject({ agent: "A", policies: 5, active: 2, grace: 1, lapsed: 1, neverPaid: 1, behind: 2 });
    expect(a.monthlyPremiumInForce).toEqual({ USD: "23.00", ZAR: "120.00" }); // 10 + 3 × 52/12 = 23.00
  });
  it("busiest agents first, the no-agent lines last", () => {
    const out = summarizePortfolio([
      pol({ agent: NO_AGENT_TYPED_IN }), pol({ agent: NO_AGENT_TYPED_IN }), pol({ agent: NO_AGENT_TYPED_IN }),
      pol({ agent: "Small" }), pol({ agent: "Big" }), pol({ agent: "Big" }), pol({ agent: NO_AGENT_WALK_IN }),
    ]);
    expect(out.map((x) => x.agent)).toEqual(["Big", "Small", NO_AGENT_TYPED_IN, NO_AGENT_WALK_IN]);
  });
});
