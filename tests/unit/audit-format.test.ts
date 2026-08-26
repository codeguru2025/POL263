import { describe, it, expect } from "vitest";
import { humanizeAction, humanizeEntityType, summarizeChanges, summarizeAuditEntry } from "../../client/src/lib/audit-format";

describe("humanizeAction", () => {
  it("turns a simple CREATE_ action into a readable past-tense phrase", () => {
    expect(humanizeAction("CREATE_CLIENT")).toBe("Created client");
  });

  it("handles a long multi-word action", () => {
    expect(humanizeAction("RECORD_CASE_SERVICE_CHARGE_PAYMENT")).toBe("Recorded case service charge payment");
  });

  it("keeps a known acronym uppercase", () => {
    expect(humanizeAction("DISABLE_MFA")).toBe("Disabled MFA");
  });

  it("falls back gracefully for a missing action", () => {
    expect(humanizeAction(null)).toBe("Did something");
    expect(humanizeAction(undefined)).toBe("Did something");
  });

  it("handles irregular verbs", () => {
    expect(humanizeAction("SEND_INVITE")).toBe("Sent invite");
    expect(humanizeAction("CANCEL_POLICY")).toBe("Cancelled policy");
  });
});

describe("humanizeEntityType", () => {
  it("splits CamelCase into spaced words", () => {
    expect(humanizeEntityType("CaseServiceCharge")).toBe("Case Service Charge");
  });

  it("keeps a leading acronym-like run readable", () => {
    expect(humanizeEntityType("MFA")).toBe("MFA");
  });

  it("returns empty string for null/undefined", () => {
    expect(humanizeEntityType(null)).toBe("");
    expect(humanizeEntityType(undefined)).toBe("");
  });
});

describe("summarizeChanges", () => {
  it("returns an empty list when before or after is missing (create/delete)", () => {
    expect(summarizeChanges(null, { status: "paid" })).toEqual([]);
    expect(summarizeChanges({ status: "paid" }, null)).toEqual([]);
  });

  it("lists only fields that actually changed, skipping technical fields", () => {
    const before = { id: "abc", organizationId: "org1", status: "unpaid", paidBy: null, createdAt: "2026-01-01" };
    const after = { id: "abc", organizationId: "org1", status: "paid", paidBy: "John", createdAt: "2026-01-01" };
    const changes = summarizeChanges(before, after);
    expect(changes).toEqual([
      { field: "Status", from: "unpaid", to: "paid" },
      { field: "Paid by", from: "—", to: "John" },
    ]);
  });

  it("caps the number of changes at the given limit", () => {
    const before = { a: 1, b: 1, c: 1, d: 1, e: 1 };
    const after = { a: 2, b: 2, c: 2, d: 2, e: 2 };
    expect(summarizeChanges(before, after, 2)).toHaveLength(2);
  });

  it("formats booleans as Yes/No", () => {
    const changes = summarizeChanges({ isActive: false }, { isActive: true });
    expect(changes[0]).toEqual({ field: "Is active", from: "No", to: "Yes" });
  });
});

describe("summarizeAuditEntry", () => {
  it("describes a create with before=null as a new record, not a diff", () => {
    const sentence = summarizeAuditEntry({
      action: "CREATE_CLIENT",
      entityType: "Client",
      actorEmail: "staff@example.com",
      before: null,
      after: { firstName: "Jane" },
    });
    expect(sentence).toBe("staff@example.com created a new client.");
  });

  it("describes a delete with after=null as a deletion", () => {
    const sentence = summarizeAuditEntry({
      action: "DELETE_CLIENT",
      entityType: "Client",
      actorEmail: "staff@example.com",
      before: { firstName: "Jane" },
      after: null,
    });
    expect(sentence).toBe("staff@example.com deleted a client.");
  });

  it("falls back to 'The system' when there's no actor", () => {
    const sentence = summarizeAuditEntry({ action: "CREATE_POLICY", entityType: "Policy", before: null, after: {} });
    expect(sentence).toBe("The system created a new policy.");
  });

  it("uses the humanized action for an update (both before and after present)", () => {
    const sentence = summarizeAuditEntry({
      action: "RECORD_STORAGE_PAYMENT",
      entityType: "MortuaryIntake",
      actorEmail: "staff@example.com",
      before: { status: "unpaid" },
      after: { status: "paid" },
    });
    expect(sentence).toBe("staff@example.com recorded storage payment.");
  });

  it("preserves an acronym's casing mid-sentence instead of flattening it (DISABLE_MFA -> ...disabled MFA, not ...disabled mfa)", () => {
    const sentence = summarizeAuditEntry({
      action: "DISABLE_MFA",
      entityType: "User",
      actorEmail: "staff@example.com",
      before: { mfaEnabled: true },
      after: { mfaEnabled: false },
    });
    expect(sentence).toBe("staff@example.com disabled MFA.");
  });
});
