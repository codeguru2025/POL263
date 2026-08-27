import { describe, it, expect, vi } from "vitest";

// general-ledger imports financial-statements → tenant-db (throws without env) and storage; stub both.
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { CHART_OF_ACCOUNTS, accountForLedgerEntry } from "../../server/general-ledger";
import type { LedgerEntry } from "../../server/financial-statements";

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  date: "2026-08-01", type: "income", source: "premium", description: "", reference: null,
  person: null, department: null, amount: 10, currency: "USD", ...over,
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
  it("maps each subsidiary-ledger source to the right P&L account", () => {
    expect(accountForLedgerEntry(entry({ source: "premium" })).code).toBe("4100");
    expect(accountForLedgerEntry(entry({ source: "cash_service" })).code).toBe("4300");
    expect(accountForLedgerEntry(entry({ source: "legacy_group" })).code).toBe("4400");
    expect(accountForLedgerEntry(entry({ source: "commission", type: "expense" })).code).toBe("5200");
    expect(accountForLedgerEntry(entry({ source: "requisition", type: "expense" })).code).toBe("5400");
    expect(accountForLedgerEntry(entry({ source: "expenditure", type: "expense" })).code).toBe("5400");
  });
});
