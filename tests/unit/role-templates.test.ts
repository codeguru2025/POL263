import { describe, it, expect } from "vitest";
import { ROLE_PERMISSION_MAP, SYSTEM_PERMISSIONS } from "../../server/constants";

// The money powers that belong to finance_manager, not the day-to-day administrator
// (Augustus, 2026-09-30): whoever takes money in must not be able to quietly change it.
const MONEY_POWERS = [
  "edit:payment", "delete:payment", "edit:receipt", "delete:receipt", "backdate:payment", "edit:premium",
  "write:finance", "approve:finance", "approve:settlements", "approve:waivers",
  "delete:expenditure", "delete:requisition",
  "read:payroll", "write:payroll", "write:commission",
];

describe("role templates", () => {
  it("administrator can't change money after the fact, see payroll or edit commissions", () => {
    for (const p of MONEY_POWERS) expect(ROLE_PERMISSION_MAP.administrator, p).not.toContain(p);
  });

  it("administrator still receipts and sees finance read-only", () => {
    for (const p of ["receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group", "read:finance", "read:commission", "manage:settings"]) {
      expect(ROLE_PERMISSION_MAP.administrator, p).toContain(p);
    }
  });

  it("finance_manager holds every money power", () => {
    for (const p of MONEY_POWERS) expect(ROLE_PERMISSION_MAP.finance_manager, p).toContain(p);
  });

  it("no tenant role can edit roles/permissions or manage tenants", () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
      for (const p of ["write:role", "manage:permissions", "create:tenant", "delete:tenant"]) expect(perms, `${role} ${p}`).not.toContain(p);
    }
  });

  it("every templated permission exists", () => {
    const known = new Set(SYSTEM_PERMISSIONS.map((p) => p.name));
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
      for (const p of perms) expect(known.has(p), `${role}: ${p}`).toBe(true);
    }
  });
});

describe("role catalogue — least privilege (2026-09-30 review)", () => {
  const R = ROLE_PERMISSION_MAP;
  it("front-line roles don't see company finance", () => {
    for (const role of ["agent", "cashier", "customer_service", "sales_team_leader", "claims_officer", "funeral_manager", "hr_officer"]) {
      expect(R[role], role).not.toContain("read:finance");
    }
  });
  it("capturing a claim and approving it are different roles", () => {
    expect(R.claims_officer).toContain("write:claim");
    expect(R.claims_officer).not.toContain("approve:claim");
    expect(R.customer_service).not.toContain("approve:claim");
  });
  it("only group managers can move policies between groups / agents", () => {
    const holders = Object.entries(R).filter(([, p]) => p.includes("write:group")).map(([r]) => r).sort();
    expect(holders).toEqual(["administrator", "manager"]);
  });
  it("payroll stays with HR, finance manager and read-only executives", () => {
    const readers = Object.entries(R).filter(([, p]) => p.includes("read:payroll")).map(([r]) => r).sort();
    expect(readers).toEqual(["executive", "finance_manager", "hr_officer"]);
  });
  it("finance clerk captures but can't approve, correct or delete money", () => {
    for (const p of ["approve:finance", "edit:payment", "delete:payment", "edit:receipt", "delete:receipt", "backdate:payment", "read:payroll"]) {
      expect(R.finance_clerk, p).not.toContain(p);
    }
  });
  it("roles that can create users are the ones that run the office", () => {
    const holders = Object.entries(R).filter(([, p]) => p.includes("write:user")).map(([r]) => r).sort();
    expect(holders).toEqual(["administrator", "manager"]);
  });
});
