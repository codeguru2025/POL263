import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  due: [] as any[],
  allowance: { metered: false, enforced: false, allocated: 0, used: 0, remaining: 0, lowBalanceThreshold: 0 },
  sendSms: vi.fn(),
  updateDelivery: vi.fn(),
  smsModule: true,
}));

vi.mock("../../server/control-plane-db", () => ({ cpDb: {} }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/user-notifications", () => ({ notifyUsersWithPermission: vi.fn() }));
vi.mock("../../server/advisory-lock", () => ({ withAdvisoryLock: async (_k: number, fn: () => Promise<void>) => fn() }));
vi.mock("../../server/module-gate", () => ({ hasModule: async () => h.smsModule }));
vi.mock("../../server/sms-service", () => ({ sendSms: (...a: any[]) => h.sendSms(...a) }));
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizations: async () => [{ id: "org1" }],
    expireStaleSmsNotificationRetries: async () => 0,
    getDueSmsNotificationRetries: async () => h.due,
    getClient: async (id: string) => ({ id, phone: "0771234567" }),
    updateNotificationLogDelivery: (...a: any[]) => h.updateDelivery(...a),
    getCountryFlagSettings: async () => ({ isEnabled: false, homeCountryCode: "263", flagCountryCode: "27" }),
  },
}));
vi.mock("../../server/sms-allocation", async (orig) => {
  const real: any = await orig();
  return { ...real, getSmsAllowance: async () => h.allowance };
});

import { countSmsSegments } from "../../server/sms-allocation";
import { runSmsRetrySweep } from "../../server/sms-retry-sweep";
import { buildSmsReportCsv, csvCell, streamSmsReportPdf, type SmsReportContext } from "../../server/sms-report";

describe("countSmsSegments — one credit per billable SMS part", () => {
  it("plain text: 160 chars is one part, then 153 per part", () => {
    expect(countSmsSegments("a".repeat(160))).toBe(1);
    expect(countSmsSegments("a".repeat(161))).toBe(2);
    expect(countSmsSegments("a".repeat(306))).toBe(2);
    expect(countSmsSegments("a".repeat(307))).toBe(3);
  });
  it("GSM extension characters (€ [ ] { } …) count double", () => {
    expect(countSmsSegments("€".repeat(80))).toBe(1);
    expect(countSmsSegments("€".repeat(81))).toBe(2);
  });
  it("emoji / non-GSM text: 70 per single part, then 67", () => {
    expect(countSmsSegments("ç".repeat(10) + "“")).toBe(1);
    expect(countSmsSegments("“".repeat(70))).toBe(1);
    expect(countSmsSegments("“".repeat(71))).toBe(2);
  });
  it("an empty message still costs one part", () => {
    expect(countSmsSegments("")).toBe(1);
  });
});

describe("SMS report export", () => {
  const ctx: SmsReportContext = {
    orgName: "Acme Funerals", timezone: "Africa/Harare", periodLabel: "2026-09-01 to 2026-09-24",
    allowance: { metered: true, enforced: true, allocated: 1000, used: 42, remaining: 958, lowBalanceThreshold: 50 },
    stats: { sent: 40, failed: 1, blocked: 1, creditsCharged: 42, segmentsSent: 42 },
    generatedBy: "admin@acme",
  };
  const row = (over: Partial<any> = {}): any => ({
    id: "m1", organizationId: "org1", recipient: "263771234567", clientId: "c1", clientName: "Jane Doe",
    message: "Hi Jane, payment received.", segments: 1, creditsCharged: 1, kind: "transactional",
    source: "notification", eventType: "payment_receipt", status: "sent", failureReason: null,
    providerMessageId: "123", notificationLogId: null, sentByUserId: null, createdAt: new Date("2026-09-10T08:00:00Z"),
    ...over,
  });

  it("CSV neutralises spreadsheet formulas in client-controlled text", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+263771")).toBe("'+263771");
    expect(csvCell("a, b")).toBe("\"a, b\"");
  });

  it("CSV has a BOM, the allowance summary, local times and readable labels", () => {
    const csv = buildSmsReportCsv([row(), row({ id: "m2", status: "blocked", creditsCharged: 0, failureReason: "Not sent — your SMS allowance is used up." })], ctx);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Remaining now,958");
    expect(csv).toContain("2026-09-10 10:00"); // Harare = UTC+2
    expect(csv).toContain("Payment Receipted");
    expect(csv).toContain("Not sent (allowance)");
  });

  it("PDF renders (incl. many rows across pages) without throwing", async () => {
    const res: any = { setHeader: vi.fn(), send: vi.fn() };
    await streamSmsReportPdf(res, Array.from({ length: 120 }, (_, i) => row({ id: `m${i}`, message: "x".repeat(i * 3) })), ctx, "r.pdf");
    const pdf: Buffer = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="r.pdf"');
  });
});

describe("SMS retry sweep", () => {
  const failedLog = (over: Partial<any> = {}) => ({
    id: "log1", recipientId: "c1", body: "Your premium is due", policyId: null, attempts: 1, failureReason: "paused", ...over,
  });
  beforeEach(() => {
    h.sendSms.mockReset();
    h.updateDelivery.mockReset();
    h.smsModule = true;
    h.allowance = { metered: false, enforced: false, allocated: 0, used: 0, remaining: 0, lowBalanceThreshold: 0 };
  });

  it("delivers a queued text and marks the log sent", async () => {
    h.due = [failedLog()];
    h.sendSms.mockResolvedValue({ ok: true, message: "sent" });
    const r = await runSmsRetrySweep();
    expect(r.delivered).toBe(1);
    expect(h.updateDelivery).toHaveBeenCalledWith("org1", "log1", expect.objectContaining({ status: "sent", nextRetryAt: null, attempts: 2 }));
  });

  it("reschedules a still-temporary failure with a longer wait", async () => {
    h.due = [failedLog()];
    h.sendSms.mockResolvedValue({ ok: false, message: "provider down", retryable: true });
    const now = new Date("2026-09-24T10:00:00Z");
    await runSmsRetrySweep(now);
    const patch = h.updateDelivery.mock.calls[0][2];
    expect(patch.attempts).toBe(2);
    expect(patch.nextRetryAt.getTime() - now.getTime()).toBe(15 * 60_000);
  });

  it("gives up on a permanent rejection", async () => {
    h.due = [failedLog()];
    h.sendSms.mockResolvedValue({ ok: false, message: "Invalid destination", retryable: false });
    const r = await runSmsRetrySweep();
    expect(r.gaveUp).toBe(1);
    expect(h.updateDelivery.mock.calls[0][2]).toMatchObject({ nextRetryAt: null, failureReason: expect.stringContaining("gave up") });
  });

  it("waits (without spending attempts) while the tenant's allowance is used up", async () => {
    h.due = [failedLog()];
    h.allowance = { metered: true, enforced: true, allocated: 100, used: 100, remaining: 0, lowBalanceThreshold: 10 };
    await runSmsRetrySweep();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.updateDelivery).not.toHaveBeenCalled();
  });

  it("stops retrying if SMS was switched off for the tenant", async () => {
    h.due = [failedLog()];
    h.smsModule = false;
    await runSmsRetrySweep();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.updateDelivery.mock.calls[0][2]).toMatchObject({ nextRetryAt: null });
  });
});
