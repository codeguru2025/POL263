import { describe, it, expect } from "vitest";
import { relativeRecordName } from "../../server/do-app-domains";

/**
 * relativeRecordName computes the zone-relative name DigitalOcean's DNS Records API expects.
 * Getting this wrong is exactly what caused a real production incident (2026-08-04,
 * ifalakhe-funeral-services.pol263.com): a record was created with the full FQDN as its name
 * instead of the relative label, producing a nonsense double-suffixed hostname that never
 * matched real traffic. See docs/BUGFIX-LOG.md for the full incident and server/do-app-domains.ts.
 */
describe("relativeRecordName", () => {
  it("strips the zone suffix to produce the relative label", () => {
    expect(relativeRecordName("acme.pol263.com", "pol263.com")).toBe("acme");
  });

  it("handles a hyphenated multi-word subdomain (the exact real-world case)", () => {
    expect(relativeRecordName("ifalakhe-funeral-services.pol263.com", "pol263.com")).toBe("ifalakhe-funeral-services");
  });

  it("is case-insensitive on both subdomain and zone", () => {
    expect(relativeRecordName("Acme.POL263.COM", "pol263.com")).toBe("acme");
  });

  it("returns '@' for the zone apex itself", () => {
    expect(relativeRecordName("pol263.com", "pol263.com")).toBe("@");
  });

  it("tolerates a trailing dot on either input", () => {
    expect(relativeRecordName("acme.pol263.com.", "pol263.com")).toBe("acme");
    expect(relativeRecordName("acme.pol263.com", "pol263.com.")).toBe("acme");
  });

  it("throws instead of silently producing a wrong record when subdomain isn't under zone", () => {
    // This is the failure mode to avoid: passing the full FQDN as if it were already relative
    // (i.e. calling this with the zone itself appended twice) must not succeed silently.
    expect(() => relativeRecordName("ifalakhe-funeral-services.pol263.com", "ifalakhe-funeral-services.pol263.com.pol263.com"))
      .toThrow(/not a subdomain of zone/);
  });

  it("throws for a completely unrelated domain", () => {
    expect(() => relativeRecordName("example.com", "pol263.com")).toThrow(/not a subdomain of zone/);
  });
});
