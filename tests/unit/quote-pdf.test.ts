import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/storage", () => ({ storage: { getQuote: vi.fn(), getOrganization: vi.fn() } }));
vi.mock("../../server/object-storage", () => ({ resolveImage: vi.fn() }));

import { resolveJoinUrl } from "../../server/quote-pdf";

describe("resolveJoinUrl", () => {
  it("points at the org's own marketing site when it has one", () => {
    const url = resolveJoinUrl({ website: "https://diasporafuneralservices.com/" }, "AGT123", "quote-1");
    expect(url).toBe("https://diasporafuneralservices.com/join?quoteId=quote-1");
  });

  it("falls back to POL263's own hosted join page with the ref code when the org has no site", () => {
    const url = resolveJoinUrl({ website: null }, "AGT123", "quote-1");
    expect(url).toContain("/join/AGT123?quoteId=quote-1");
  });

  it("omits the ref segment when there is no referral code", () => {
    const url = resolveJoinUrl({ website: null }, null, "quote-1");
    expect(url).toContain("/join?quoteId=quote-1");
    expect(url).not.toContain("/join/");
  });
});
