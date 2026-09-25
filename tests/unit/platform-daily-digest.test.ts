import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/scheduler-claims", () => ({ claimSchedulerRun: vi.fn() }));
vi.mock("../../server/daily-report", () => ({ buildDailyReport: vi.fn() }));
vi.mock("../../server/email-service", () => ({
  sendEmail: vi.fn(),
  escapeHtml: (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
}));
vi.mock("../../server/constants", () => ({ PLATFORM_OWNER_EMAIL: "owner@example.com" }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { yesterdayIn, csvCell, toCsv, renderDigestHtml, digestRecipients, buildDigestAttachments, type TenantDigest } from "../../server/platform-daily-digest";

const emptyDigest = (over: Partial<TenantDigest> = {}): TenantDigest => ({
  orgId: "o1", orgName: "Falakhe <Funeral>", date: "2026-09-24", timezone: "Africa/Harare",
  receipts: [], receiptTotals: { byCurrency: {}, byChannel: {}, byStaff: {}, count: 0, pendingApproval: 0 },
  newClients: 0, newPolicies: [], newPoliciesByAgent: {}, policiesActivated: [], policyMovements: [], holderChanges: [],
  leads: [], quotations: [], claimsNew: [], claimMovements: [], ledgerEntries: [],
  funeralCases: [], mortuaryIntakes: [], mortuaryDispatches: [],
  approvals: { created: 0, resolved: 0, pending: 0, byType: {} },
  notifications: { byChannelStatus: {}, failures: [] },
  platformFees: {},
  audit: { total: 0, byActor: {}, byAction: {}, rows: [] },
  snapshot: { activePolicies: 0, gracePolicies: 0, lapsedPolicies: 0, openClaims: 0, overdueClaims: 0 },
  ...over,
});

describe("yesterdayIn", () => {
  it("uses the tenant's local calendar day, not UTC", () => {
    // 23:30 UTC on the 24th is already 01:30 on the 25th in Harare, so "yesterday" is the 24th.
    expect(yesterdayIn("Africa/Harare", new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-24");
    expect(yesterdayIn("UTC", new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-23");
  });
  it("crosses month boundaries", () => {
    expect(yesterdayIn("Africa/Harare", new Date("2026-10-01T08:00:00Z"))).toBe("2026-09-30");
  });
});

describe("CSV attachments", () => {
  it("neutralises spreadsheet formulas and quotes commas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("Moyo, Judith")).toBe("\"Moyo, Judith\"");
    expect(csvCell(null)).toBe("");
  });
  it("writes a header row and one line per row", () => {
    expect(toCsv([{ a: 1, b: "x" }, { a: 2, b: "y" }], ["a", "b"])).toBe("a,b\r\n1,x\r\n2,y");
  });
  it("attaches every staff action and every receipt for each tenant", () => {
    const files = buildDigestAttachments([emptyDigest({
      audit: { total: 1, byActor: { a: 1 }, byAction: { X: 1 }, rows: [{ timestamp: "t", actor: "a", action: "X", entity_type: "Claim", entity_id: "1", ip_address: null }] },
    })]);
    expect(files.map((f) => f.filename)).toEqual([
      "falakhe-funeral-2026-09-24-staff-activity.csv",
      "falakhe-funeral-2026-09-24-receipts.csv",
    ]);
    expect(files[0].content).toContain("Claim");
  });
});

describe("renderDigestHtml", () => {
  it("escapes tenant data and totals receipts across tenants", () => {
    const html = renderDigestHtml("2026-09-24", [
      emptyDigest({ receiptTotals: { byCurrency: { USD: 49 }, byChannel: {}, byStaff: {}, count: 4, pendingApproval: 0 } }),
      emptyDigest({ orgName: "Other", receiptTotals: { byCurrency: { USD: 1, ZAR: 10 }, byChannel: {}, byStaff: {}, count: 1, pendingApproval: 0 } }),
    ], [{ orgName: "Broken Co", error: "db down" }]);
    expect(html).toContain("Falakhe &lt;Funeral&gt;");
    expect(html).not.toContain("<Funeral>");
    expect(html).toContain("USD 50.00");
    expect(html).toContain("Broken Co");
  });
});

describe("digestRecipients", () => {
  it("defaults to the platform owner, or uses DAILY_DIGEST_EMAILS", () => {
    delete process.env.DAILY_DIGEST_EMAILS;
    expect(digestRecipients()).toEqual(["owner@example.com"]);
    process.env.DAILY_DIGEST_EMAILS = "a@x.com, b@y.com";
    expect(digestRecipients()).toEqual(["a@x.com", "b@y.com"]);
    delete process.env.DAILY_DIGEST_EMAILS;
  });
});
