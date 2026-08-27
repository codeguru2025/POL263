import { describe, it, expect, vi, beforeEach } from "vitest";
import { differenceInCalendarMonths } from "date-fns";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

const h = vi.hoisted(() => ({
  getPaymentsByPolicy: vi.fn(),
  getPolicyCreditBalance: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { getPaymentsByPolicy: h.getPaymentsByPolicy, getPolicyCreditBalance: h.getPolicyCreditBalance },
}));

import { enrichPoliciesWithBalance } from "../../server/policy-balance";
import { storage } from "../../server/storage";

/**
 * The EXACT pre-extraction implementation, copied verbatim from server/client-auth.ts's inline
 * `enrichWithBalance` (git history). The parity test below asserts the extracted helper produces
 * byte-identical output for identical inputs.
 */
async function legacyEnrichWithBalance(policies: any[], orgId: string) {
  const enriched = [];
  for (const p of policies) {
    const payments = await storage.getPaymentsByPolicy(p.id, orgId);
    const totalPaid = payments
      .filter((tx: any) => tx.status === "cleared")
      .reduce((sum: number, tx: any) => sum + parseFloat(tx.amount || "0"), 0);
    const premium = parseFloat(p.premiumAmount || "0");
    const startDate = p.inceptionDate || p.effectiveDate;
    let totalDue = 0;
    let periodsElapsed = 0;
    if (startDate && premium > 0) {
      const start = new Date(startDate);
      const now = new Date();
      if (!isNaN(start.getTime()) && start <= now) {
        const schedule = p.paymentSchedule || "monthly";
        if (schedule === "monthly") {
          periodsElapsed = Math.max(0, differenceInCalendarMonths(now, start));
        } else if (schedule === "quarterly") {
          periodsElapsed = Math.max(0, Math.floor(differenceInCalendarMonths(now, start) / 3));
        } else if (schedule === "annually") {
          periodsElapsed = Math.max(0, Math.floor(differenceInCalendarMonths(now, start) / 12));
        } else {
          const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
          const periodDays = schedule === "weekly" ? 7 : 14;
          periodsElapsed = Math.max(0, Math.ceil(daysElapsed / periodDays));
        }
        totalDue = periodsElapsed * premium;
      }
    }
    const wallet = await storage.getPolicyCreditBalance(orgId, p.id);
    const walletBalance = parseFloat(String(wallet?.balance ?? "0")) || 0;
    const balance = totalPaid + walletBalance - totalDue;
    enriched.push({
      ...p,
      totalPaid: totalPaid.toFixed(2),
      totalDue: totalDue.toFixed(2),
      balance: balance.toFixed(2),
      outstanding: Math.max(0, -balance).toFixed(2),
      walletBalance: walletBalance.toFixed(2),
      periodsElapsed,
    });
  }
  return enriched;
}

const twoYearsAgo = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
};

const FIXTURES = [
  { id: "p1", premiumAmount: "25.00", paymentSchedule: "monthly", inceptionDate: twoYearsAgo(), currency: "USD" },
  { id: "p2", premiumAmount: "300.00", paymentSchedule: "annually", inceptionDate: twoYearsAgo(), effectiveDate: null },
  { id: "p3", premiumAmount: "10.00", paymentSchedule: "weekly", effectiveDate: twoYearsAgo(), inceptionDate: null },
  { id: "p4", premiumAmount: "0", paymentSchedule: "monthly", inceptionDate: twoYearsAgo() },      // no premium
  { id: "p5", premiumAmount: "50.00", paymentSchedule: "monthly", inceptionDate: null, effectiveDate: null }, // no start
  { id: "p6", premiumAmount: "40.00", paymentSchedule: "quarterly", inceptionDate: "2999-01-01" }, // future start
];

function stubStorage(perPolicy: Record<string, { payments: any[]; wallet: any }>) {
  h.getPaymentsByPolicy.mockImplementation(async (pid: string) => perPolicy[pid]?.payments ?? []);
  h.getPolicyCreditBalance.mockImplementation(async (_org: string, pid: string) => perPolicy[pid]?.wallet ?? undefined);
}

beforeEach(() => {
  h.getPaymentsByPolicy.mockReset();
  h.getPolicyCreditBalance.mockReset();
});

describe("enrichPoliciesWithBalance — parity with the pre-extraction client-auth implementation", () => {
  const scenarios = [
    {},
    { p1: { payments: [{ status: "cleared", amount: "100" }, { status: "pending", amount: "999" }], wallet: { balance: "5.50" } } },
    { p2: { payments: [{ status: "cleared", amount: "300" }], wallet: { balance: "-30" } } },
    { p3: { payments: [], wallet: { balance: "0" } } },
    {
      p1: { payments: [{ status: "cleared", amount: "12.34" }, { status: "cleared", amount: "7.66" }], wallet: null },
      p2: { payments: [{ status: "cleared", amount: "600" }], wallet: { balance: "15" } },
      p3: { payments: [{ status: "reversed", amount: "10" }], wallet: undefined },
    },
  ];

  scenarios.forEach((perPolicy, i) => {
    it(`scenario ${i}: extracted output === legacy output (byte-for-byte)`, async () => {
      stubStorage(perPolicy as any);
      const extracted = await enrichPoliciesWithBalance(structuredClone(FIXTURES), "org-1");
      stubStorage(perPolicy as any);
      const legacy = await legacyEnrichWithBalance(structuredClone(FIXTURES), "org-1");
      expect(JSON.stringify(extracted)).toBe(JSON.stringify(legacy));
    });
  });
});

describe("enrichPoliciesWithBalance — behaviour", () => {
  it("spreads the original policy and adds exactly the six balance fields", async () => {
    stubStorage({ p1: { payments: [{ status: "cleared", amount: "50" }], wallet: { balance: "0" } } });
    const [out] = await enrichPoliciesWithBalance([{ id: "p1", premiumAmount: "25", paymentSchedule: "monthly", inceptionDate: twoYearsAgo(), foo: "bar" }], "org-1");
    expect(out.foo).toBe("bar");
    for (const k of ["totalPaid", "totalDue", "balance", "outstanding", "walletBalance", "periodsElapsed"]) {
      expect(out).toHaveProperty(k);
    }
  });

  it("outstanding is 0 when paid ahead, positive when in arrears", async () => {
    stubStorage({ p1: { payments: [{ status: "cleared", amount: "100000" }], wallet: { balance: "0" } } });
    const [ahead] = await enrichPoliciesWithBalance([{ id: "p1", premiumAmount: "25", paymentSchedule: "monthly", inceptionDate: twoYearsAgo() }], "o");
    expect(ahead.outstanding).toBe("0.00");
    expect(parseFloat(ahead.balance)).toBeGreaterThan(0);

    stubStorage({ p1: { payments: [], wallet: { balance: "0" } } });
    const [behind] = await enrichPoliciesWithBalance([{ id: "p1", premiumAmount: "25", paymentSchedule: "monthly", inceptionDate: twoYearsAgo() }], "o");
    expect(parseFloat(behind.outstanding)).toBeGreaterThan(0);
  });
});
