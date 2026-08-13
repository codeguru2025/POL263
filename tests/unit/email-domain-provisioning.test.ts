import { describe, it, expect, vi } from "vitest";

// zoneRelativeNameForResendRecord is a pure function, but importing the module also pulls in
// control-plane-db (which throws at import time without a DATABASE_URL) — mock it out, same
// pattern as tests/unit/middleware.test.ts.
vi.mock("../../server/control-plane-db", () => ({ cpDb: {} }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("@shared/control-plane-schema", () => ({ tenants: {}, tenantEmailDomains: {} }));

import { zoneRelativeNameForResendRecord, type ResendDomainRecord } from "../../server/email-domain-provisioning";

function rec(overrides: Partial<ResendDomainRecord>): ResendDomainRecord {
  return { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "v", ...overrides };
}

/**
 * Resend returns record.name already relative to the registrable root domain (pol263.com),
 * not relative to the tenant subdomain being verified — confirmed empirically 2026-08-13 while
 * provisioning kings-and-queens-funeral-assurance.pol263.com's email domain. A previous version
 * of this function assumed the opposite and concatenated the subdomain prefix onto rec.name,
 * doubling it and producing dead DNS records that could never verify (e.g.
 * "send.kings-and-queens-funeral-assurance.kings-and-queens-funeral-assurance") — the same class
 * of bug already fixed once for do-app-domains.ts's relativeRecordName (see docs/BUGFIX-LOG.md,
 * 2026-08-04 incident).
 */
describe("zoneRelativeNameForResendRecord", () => {
  it("passes through a record name that already includes the subdomain prefix (the real-world case)", () => {
    expect(
      zoneRelativeNameForResendRecord(
        rec({ name: "resend._domainkey.kings-and-queens-funeral-assurance" }),
        "kings-and-queens-funeral-assurance"
      )
    ).toBe("resend._domainkey.kings-and-queens-funeral-assurance");
  });

  it("passes through a bare subdomain-apex record name unchanged (the Receiving MX case)", () => {
    expect(
      zoneRelativeNameForResendRecord(rec({ name: "kings-and-queens-funeral-assurance" }), "kings-and-queens-funeral-assurance")
    ).toBe("kings-and-queens-funeral-assurance");
  });

  it("does NOT double the subdomain prefix", () => {
    const result = zoneRelativeNameForResendRecord(
      rec({ name: "send.kings-and-queens-funeral-assurance" }),
      "kings-and-queens-funeral-assurance"
    );
    expect(result).toBe("send.kings-and-queens-funeral-assurance");
    expect(result).not.toContain("kings-and-queens-funeral-assurance.kings-and-queens-funeral-assurance");
  });

  it("passes through '@' unchanged", () => {
    expect(zoneRelativeNameForResendRecord(rec({ name: "@" }), "falakhe")).toBe("@");
  });

  it("throws instead of silently creating a record for an unrelated subdomain", () => {
    expect(() =>
      zoneRelativeNameForResendRecord(rec({ name: "resend._domainkey.some-other-tenant" }), "falakhe")
    ).toThrow(/doesn't look like it belongs to subdomain/);
  });
});
