import { describe, it, expect } from "vitest";
import { summarizeNewJoinings, WALK_IN_AGENT, type NewJoiningRow } from "../../server/new-joinings";

const row = (o: Partial<NewJoiningRow>): NewJoiningRow => ({
  policyId: Math.random().toString(36).slice(2), isLegacy: false, agentId: "a1", agentName: "Gugu",
  premium: "10.00", currency: "USD", paid: "paid", ...o,
});

describe("summarizeNewJoinings", () => {
  it("counts only new business — migrated (legacy) captures are reported separately", () => {
    const s = summarizeNewJoinings([row({}), row({ isLegacy: true }), row({ isLegacy: true, paid: "unpaid" })]);
    expect(s.newBusiness).toBe(1);
    expect(s.legacyCaptured).toBe(2);
    expect(s.premium).toEqual({ USD: "10.00" });
    expect(s.byAgent).toHaveLength(1);
  });

  it("splits paid, paid through the group, and not paid yet", () => {
    const s = summarizeNewJoinings([row({}), row({ paid: "group" }), row({ paid: "unpaid" }), row({ paid: "unpaid" })]);
    expect([s.paid, s.paidThroughGroup, s.unpaid]).toEqual([1, 1, 2]);
    expect(s.byAgent[0]).toMatchObject({ count: 4, paid: 2, unpaid: 2 });
  });

  it("keeps premium per currency and exact to the cent", () => {
    const s = summarizeNewJoinings([row({ premium: "0.10" }), row({ premium: "0.20" }), row({ premium: "200", currency: "ZAR" })]);
    expect(s.premium).toEqual({ USD: "0.30", ZAR: "200.00" });
  });

  it("puts policies with no agent on one Walk-in line, busiest agent first", () => {
    const s = summarizeNewJoinings([
      row({ agentId: null, agentName: "" }), row({ agentId: null, agentName: "" }),
      row({ agentId: "a2", agentName: "Pesuate" }),
    ]);
    expect(s.byAgent.map((a) => [a.agentName, a.count])).toEqual([[WALK_IN_AGENT, 2], ["Pesuate", 1]]);
    expect(s.byAgent[0].agentId).toBeNull();
  });
});
