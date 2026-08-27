import { describe, it, expect } from "vitest";
import { humanizeAction, humanizeEntityType, summarizeChanges, summarizeAuditEntry, renderChange } from "../../client/src/lib/audit-format";

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
  it("returns an empty list when both before and after are missing", () => {
    expect(summarizeChanges(null, null)).toEqual([]);
  });

  it("lists only fields that actually changed, skipping technical fields, tagged as a diff", () => {
    const before = { id: "abc", organizationId: "org1", status: "unpaid", paidBy: null, createdAt: "2026-01-01" };
    const after = { id: "abc", organizationId: "org1", status: "paid", paidBy: "John", createdAt: "2026-01-01" };
    const changes = summarizeChanges(before, after);
    expect(changes).toEqual([
      { field: "Status", kind: "diff", from: "unpaid", to: "paid" },
      { field: "Paid", kind: "diff", from: "—", to: "John" },
    ]);
  });

  it("caps the number of changes at the given limit", () => {
    const before = { a: 1, b: 1, c: 1, d: 1, e: 1 };
    const after = { a: 2, b: 2, c: 2, d: 2, e: 2 };
    expect(summarizeChanges(before, after, {}, 2)).toHaveLength(2);
  });

  it("formats booleans as Yes/No", () => {
    const changes = summarizeChanges({ isActive: false }, { isActive: true });
    expect(changes[0]).toEqual({ field: "Is active", kind: "diff", from: "No", to: "Yes" });
  });

  it("a create (before=null) shows a snapshot of the created record's own fields, not an empty list", () => {
    const changes = summarizeChanges(null, { policyNumber: "FLK00123", memberName: "Jane Moyo", relationship: "Spouse" });
    expect(changes).toEqual([
      { field: "Policy number", kind: "snapshot", from: "", to: "FLK00123" },
      { field: "Member name", kind: "snapshot", from: "", to: "Jane Moyo" },
      { field: "Relationship", kind: "snapshot", from: "", to: "Spouse" },
    ]);
  });

  it("a delete (after=null) shows a snapshot of the deleted record's own fields", () => {
    const changes = summarizeChanges({ policyNumber: "FLK00123" }, null);
    expect(changes).toEqual([{ field: "Policy number", kind: "snapshot", from: "", to: "FLK00123" }]);
  });

  it("skips unset fields on a create/delete snapshot (not worth a line)", () => {
    const changes = summarizeChanges(null, { name: "Jane", notes: null, tags: [] });
    expect(changes).toEqual([{ field: "Name", kind: "snapshot", from: "", to: "Jane" }]);
  });

  it("resolves a raw foreign-key UUID to its label via refs, and drops the Id/By jargon suffix", () => {
    const refs = { "e7e7f9d3-c822-43c5-b9a5-f919f613f0e4": "Tendai Moyo" };
    const changes = summarizeChanges(
      { removalDriverId: null },
      { removalDriverId: "e7e7f9d3-c822-43c5-b9a5-f919f613f0e4" },
      refs
    );
    expect(changes).toEqual([{ field: "Removal driver", kind: "diff", from: "—", to: "Tendai Moyo" }]);
  });
});

describe("renderChange", () => {
  it("renders a diff as 'old → new'", () => {
    expect(renderChange({ field: "Status", kind: "diff", from: "unpaid", to: "paid" })).toBe("unpaid → paid");
  });

  it("renders a create/delete snapshot with an em-dash on the 'from' side, not the value alone", () => {
    expect(renderChange({ field: "Policy number", kind: "snapshot", from: "", to: "FLK00123" })).toBe("— → FLK00123");
  });
});

describe("summarizeAuditEntry", () => {
  it("describes a create with before=null as a new record, naming it from an identifying field", () => {
    const sentence = summarizeAuditEntry({
      action: "CREATE_POLICY_MEMBER",
      entityType: "PolicyMember",
      actorEmail: "staff@example.com",
      before: null,
      after: { memberName: "Jane Moyo", relationship: "Spouse" },
    });
    expect(sentence).toBe("staff@example.com created a new policy member (Jane Moyo).");
  });

  it("falls back to firstName/lastName for the inline label when no priority field matches", () => {
    const sentence = summarizeAuditEntry({
      action: "CREATE_CLIENT",
      entityType: "Client",
      actorEmail: "staff@example.com",
      before: null,
      after: { firstName: "Jane", lastName: "Doe" },
    });
    expect(sentence).toBe("staff@example.com created a new client (Jane Doe).");
  });

  it("omits the inline label entirely when no identifying field is present", () => {
    const sentence = summarizeAuditEntry({
      action: "CREATE_CLIENT",
      entityType: "Client",
      actorEmail: "staff@example.com",
      before: null,
      after: { status: "active" },
    });
    expect(sentence).toBe("staff@example.com created a new client.");
  });

  it("describes a delete with after=null as a deletion, naming it from an identifying field", () => {
    const sentence = summarizeAuditEntry({
      action: "DELETE_CLIENT",
      entityType: "Client",
      actorEmail: "staff@example.com",
      before: { firstName: "Jane" },
      after: null,
    });
    expect(sentence).toBe("staff@example.com deleted a client (Jane).");
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

  it("lowercases every word of a multi-word entity type mid-sentence, not just the first", () => {
    const sentence = summarizeAuditEntry({
      action: "CREATE_POLICY_MEMBER",
      entityType: "PolicyMember",
      actorEmail: "staff@example.com",
      before: null,
      after: { status: "active" },
    });
    expect(sentence).toBe("staff@example.com created a new policy member.");
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
