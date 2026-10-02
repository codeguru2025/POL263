import { describe, it, expect } from "vitest";
import { isPostgresUrl } from "../../shared/validation";

describe("isPostgresUrl — tenant database address guard", () => {
  it("accepts postgres connection strings", () => {
    expect(isPostgresUrl("postgresql://user:pw@db.example.com:25061/defaultdb?sslmode=require")).toBe(true);
    expect(isPostgresUrl("postgres://u:p@localhost/x")).toBe(true);
  });
  it("rejects a password typed (or autofilled) into the field, and other junk", () => {
    expect(isPostgresUrl("ncube2026")).toBe(false);
    expect(isPostgresUrl("https://example.com")).toBe(false);
    expect(isPostgresUrl("")).toBe(false);
    expect(isPostgresUrl(null)).toBe(false);
  });
});
