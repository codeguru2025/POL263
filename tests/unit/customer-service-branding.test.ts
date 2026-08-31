import { describe, it, expect, vi, beforeEach } from "vitest";

const S = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: S }));

import { getBrandingContext, toBrandingResponse } from "../../server/customer-service-branding";

beforeEach(() => vi.clearAllMocks());

describe("getBrandingContext", () => {
  it("maps the branding-merged organization row to the message-layer shape", async () => {
    S.getOrganization.mockResolvedValue({
      name: "FALAKHE FUNERAL PARLOUR",
      logoUrl: "/assets/falakhe.png",
      primaryColor: "#123456",
      phone: "+263242000000",
      email: "care@falakhe.example",
      website: "https://falakhe.example",
      footerText: "Thank you.",
      databaseUrl: "postgres://secret", // must NOT surface
    });
    const b = await getBrandingContext("org-A");
    expect(b).toEqual({
      name: "FALAKHE FUNERAL PARLOUR",
      displayName: "FALAKHE",
      logoUrl: "/assets/falakhe.png",
      primaryColor: "#123456",
      supportPhone: "+263242000000",
      supportEmail: "care@falakhe.example",
      website: "https://falakhe.example",
      footerText: "Thank you.",
    });
  });

  it("returns a generic (all-null) context when the org can't be loaded", async () => {
    S.getOrganization.mockResolvedValue(undefined);
    expect(await getBrandingContext("nope")).toEqual({
      name: null, displayName: null, logoUrl: null, primaryColor: null,
      supportPhone: null, supportEmail: null, website: null, footerText: null,
    });
  });

  it("swallows storage errors into the generic context", async () => {
    S.getOrganization.mockRejectedValue(new Error("cp down"));
    const b = await getBrandingContext("org-A");
    expect(b.name).toBeNull();
  });

  it("toBrandingResponse is snake_case and leaks nothing", () => {
    const r = toBrandingResponse({
      name: "X", displayName: "X", logoUrl: "l", primaryColor: "c",
      supportPhone: "p", supportEmail: "e", website: "w", footerText: "f",
    });
    expect(Object.keys(r).sort()).toEqual(
      ["display_name", "footer_text", "logo_url", "name", "primary_color", "support_email", "support_phone", "website"].sort(),
    );
  });
});
