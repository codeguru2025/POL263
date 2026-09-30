import { describe, it, expect, vi } from "vitest";

// general-ledger imports financial-statements → tenant-db (throws without env) and storage; stub both.
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { CHART_OF_ACCOUNTS, accountForLedgerEntry, assembleTrialBalance, postToGeneralLedger, type TrialBalanceInputs } from "../../server/general-ledger";
import type { LedgerEntry } from "../../server/financial-statements";

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  date: "2026-08-01", type: "income", source: "premium", description: "", reference: null,
  person: null, department: null, amount: 10, currency: "USD", cash: true, ...over,
});

describe("chart of accounts", () => {
  it("has unique, sorted-block account codes with a normal balance side per class", () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of CHART_OF_ACCOUNTS) {
      const expected = a.class === "asset" || a.class === "expense" ? "debit" : "credit";
      expect(a.normal, `${a.code} ${a.name}`).toBe(expected);
    }
  });

  it("uses the conventional 1/2/3/4/5 leading digit per class", () => {
    const lead: Record<string, string> = { asset: "1", liability: "2", equity: "3", income: "4", expense: "5" };
    for (const a of CHART_OF_ACCOUNTS) expect(a.code[0], `${a.code}`).toBe(lead[a.class]);
  });
});

describe("accountForLedgerEntry", () => {
  it("maps each event to the income/expense account it lands in (or the liability a payment reduces)", () => {
    expect(accountForLedgerEntry(entry({ source: "premium" })).code).toBe("4100");
    expect(accountForLedgerEntry(entry({ source: "premium_group" })).code).toBe("4200");
    expect(accountForLedgerEntry(entry({ source: "cash_service" })).code).toBe("4300");
    expect(accountForLedgerEntry(entry({ source: "legacy_group" })).code).toBe("4400");
    expect(accountForLedgerEntry(entry({ source: "commission_earned", type: "expense" })).code).toBe("5200");
    expect(accountForLedgerEntry(entry({ source: "requisition", type: "expense" })).code).toBe("5400");
    expect(accountForLedgerEntry(entry({ source: "claim", type: "expense" })).code).toBe("5100");
    expect(accountForLedgerEntry(entry({ source: "commission_paid", type: "payment" })).code).toBe("2300");
    expect(accountForLedgerEntry(entry({ source: "pol263_bill", type: "payment" })).code).toBe("2900");
  });
});

describe("postToGeneralLedger — double entry", () => {
  const events: LedgerEntry[] = [
    entry({ source: "premium", amount: 100 }),
    entry({ source: "legacy_group", amount: 60, currency: "ZAR" }),
    entry({ source: "requisition", type: "expense", amount: 30 }),
    entry({ source: "commission_earned", type: "expense", amount: 10, cash: false }),
    entry({ source: "commission_earned", type: "expense", amount: -4, cash: false }), // a clawback
    entry({ source: "commission_paid", type: "payment", amount: 5 }),
    entry({ source: "platform_fee", type: "expense", amount: 2.5, cash: false }),
  ];

  it("posts every event as one debit line and one credit line, so debits equal credits per currency", () => {
    const { lines } = postToGeneralLedger(events);
    expect(lines).toHaveLength(events.length * 2);
    const sum = (cur: string, side: "debit" | "credit") => Math.round(lines.filter((l) => l.currency === cur).reduce((s, l) => s + (l[side] ?? 0), 0) * 100) / 100;
    expect(sum("USD", "debit")).toBe(sum("USD", "credit"));
    expect(sum("ZAR", "debit")).toBe(sum("ZAR", "credit"));
  });

  it("totals each account like the trial balance: cash, commission owed after a clawback and a payment", () => {
    const { accounts } = postToGeneralLedger(events);
    const acc = (code: string) => accounts.find((a) => a.code === code)!;
    expect(acc("1100").debit).toEqual({ USD: 100, ZAR: 60 });
    expect(acc("1100").credit).toEqual({ USD: 35 }); // requisition 30 + commission paid 5
    expect(acc("2300").credit).toEqual({ USD: 10 }); // earned
    expect(acc("2300").debit).toEqual({ USD: 9 }); // clawback 4 + paid 5
    expect(acc("2900").credit).toEqual({ USD: 2.5 });
  });

  it("shows only the chosen account's lines, with the other side named", () => {
    const { lines } = postToGeneralLedger(events, "2300");
    expect(lines.every((l) => l.account === "2300")).toBe(true);
    expect(lines.find((l) => l.debit === 5)?.contraAccount).toBe("1100");
  });
});

describe("assembleTrialBalance — debits always equal credits", () => {
  const totals = (rows: ReturnType<typeof assembleTrialBalance>["rows"]) => {
    const dr: Record<string, number> = {}, cr: Record<string, number> = {};
    for (const r of rows) {
      for (const [c, v] of Object.entries(r.debit)) dr[c] = Math.round(((dr[c] ?? 0) + v) * 100) / 100;
      for (const [c, v] of Object.entries(r.credit)) cr[c] = Math.round(((cr[c] ?? 0) + v) * 100) / 100;
    }
    return { dr, cr };
  };
  const line = (rows: ReturnType<typeof assembleTrialBalance>["rows"], code: string) => rows.find((r) => r.code === code);

  // Falakhe, Sep 2026 — the figures that exposed the old imbalance (Dr 13,947 vs Cr 24,295.06).
  const sep: TrialBalanceInputs = {
    income: {
      premiumIndividual: { USD: 2367, ZAR: 3665 }, premiumGroup: { USD: 1402, ZAR: 900 },
      cashServices: { USD: 4030, ZAR: 6900 }, legacyGroupIncome: { USD: 6148, ZAR: 11150 },
      total: { USD: 13947, ZAR: 22615 },
    },
    expenses: {
      lines: [
        { source: "requisition", amounts: { USD: 3078.3 } },
        { source: "commission", amounts: { USD: 171.4 } },
        { source: "platform_fee", amounts: { USD: 349.24, ZAR: 565.38 } },
      ],
      total: { USD: 3598.94, ZAR: 565.38 },
    },
    cashFlow: { netCash: { USD: 10712.7, ZAR: 22615 }, outflows: { commissions: { USD: 156 } } },
  };

  it("balances in every currency, with cash from the cash-flow statement", () => {
    const { rows, surplus } = assembleTrialBalance(sep);
    const { dr, cr } = totals(rows);
    expect(dr).toEqual({ USD: 14311.64, ZAR: 23180.38 });
    expect(cr).toEqual(dr);
    expect(line(rows, "1100")?.debit).toEqual({ USD: 10712.7, ZAR: 22615 });
    expect(surplus).toEqual({ USD: 10348.06, ZAR: 22049.62 });
  });

  it("puts costs not yet paid in their payable accounts, and never posts a surplus line", () => {
    const { rows } = assembleTrialBalance(sep);
    expect(line(rows, "2300")?.credit).toEqual({ USD: 15.4 }); // commission earned 171.40 − paid 156
    expect(line(rows, "2900")?.credit).toEqual({ USD: 349.24, ZAR: 565.38 }); // no POL263 bill paid
    expect(line(rows, "5200")?.debit).toEqual({ USD: 171.4 });
    expect(line(rows, "3900")).toBeUndefined();
  });

  it("shows a payable going down (debit) when more was paid than recognised, and still balances", () => {
    const { rows } = assembleTrialBalance({
      income: { premiumIndividual: { USD: 100 }, premiumGroup: {}, cashServices: {}, legacyGroupIncome: {}, total: { USD: 100 } },
      expenses: { lines: [{ source: "claims", amounts: { USD: 20 } }, { source: "payroll", amounts: { USD: 30 } }], total: { USD: 50 } },
      // Paid 50 of claims (30 carried from last period) and 30 of payroll.
      cashFlow: { netCash: { USD: 20 }, outflows: { claims: { USD: 50 }, payroll: { USD: 30 } } },
    });
    const { dr, cr } = totals(rows);
    expect(dr).toEqual(cr);
    expect(line(rows, "2100")?.debit).toEqual({ USD: 30 });
    expect(line(rows, "2400")).toBeUndefined();
  });
});
