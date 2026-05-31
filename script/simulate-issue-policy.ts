/**
 * Simulate issuing a policy — same backend flow as Staff → Policies → Create.
 *
 * Scenarios:
 *   1. Existing lead  — client record with no policy yet
 *   2. New client     — creates client then issues policy
 *
 * Usage:
 *   npx tsx script/simulate-issue-policy.ts
 *   npx tsx script/simulate-issue-policy.ts --mode=lead
 *   npx tsx script/simulate-issue-policy.ts --mode=new
 *   ORG_ID=<uuid> npx tsx script/simulate-issue-policy.ts
 *
 * Requires .env with DATABASE_URL and at least one org with an active product version.
 */
import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { computePolicyPremium } from "../server/route-helpers";
import { orgUsesDedicatedDatabase } from "../server/tenant-db";
import { organizations, clients, policies, productVersions, products } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getDbForOrg } from "../server/tenant-db";

type Mode = "both" | "lead" | "new";

function parseMode(): Mode {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const v = arg?.split("=")[1] as Mode | undefined;
  if (v === "lead" || v === "new" || v === "both") return v;
  return "both";
}

function shouldSeedLead(): boolean {
  return process.argv.includes("--seed-lead");
}

async function resolveOrgId(): Promise<string> {
  if (process.env.ORG_ID) return process.env.ORG_ID;
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const active = orgs.filter((o) => !o.name?.endsWith("(deleted)"));

  for (const o of active) {
    const tdb = await getDbForOrg(o.id);
    const rows = await tdb
      .select({ id: productVersions.id })
      .from(productVersions)
      .innerJoin(products, eq(productVersions.productId, products.id))
      .where(eq(products.organizationId, o.id))
      .limit(1);
    if (rows.length > 0) {
      console.log(`Using org: ${o.name} (${o.id})`);
      return o.id;
    }
  }
  throw new Error("No organization with products found. Create a product first or set ORG_ID.");
}

async function resolveActiveProductVersion(orgId: string): Promise<{ productVersionId: string; productName: string; currency: string }> {
  const tdb = await getDbForOrg(orgId);
  const rows = await tdb
    .select({
      versionId: productVersions.id,
      productId: products.id,
      productName: products.name,
      isActive: productVersions.isActive,
      premiumUsd: productVersions.premiumMonthlyUsd,
      premiumZar: productVersions.premiumMonthlyZar,
    })
    .from(productVersions)
    .innerJoin(products, eq(productVersions.productId, products.id))
    .where(eq(products.organizationId, orgId));

  const active = rows.find((r) => r.isActive) ?? rows[0];
  if (!active) throw new Error("No product version found for org. Create a product first.");
  const currency = active.premiumUsd ? "USD" : active.premiumZar ? "ZAR" : "USD";
  return { productVersionId: active.versionId, productName: active.productName, currency };
}

async function findLeadClient(orgId: string): Promise<{ id: string; name: string } | null> {
  const tdb = await getDbForOrg(orgId);
  const allClients = await tdb.select().from(clients).where(eq(clients.organizationId, orgId)).limit(200);
  for (const c of allClients) {
    const existing = await storage.getPoliciesByClient(c.id, orgId);
    const hasLivePolicy = existing.some((p) => p.status !== "cancelled");
    if (!hasLivePolicy) {
      return { id: c.id, name: `${c.firstName} ${c.lastName}`.trim() };
    }
  }
  return null;
}

async function createSimClient(orgId: string, suffix: string) {
  const ts = Date.now().toString().replace(/\D/g, "").slice(-8).padStart(8, "0");
  const nationalId = `${ts}H38`;
  const phone = `077${Date.now().toString().slice(-7)}`;
  return storage.createClient({
    organizationId: orgId,
    firstName: "SIM",
    lastName: `CLIENT${suffix}`,
    phone,
    nationalId,
    dateOfBirth: "1990-05-15",
    gender: "MALE",
    email: `sim.${suffix.toLowerCase()}.${ts}@example.test`,
    isActive: true,
  });
}

async function issuePolicyForClient(
  orgId: string,
  clientId: string,
  productVersionId: string,
  currency: string,
  label: string,
) {
  const client = await storage.getClient(clientId, orgId);
  if (!client) throw new Error(`Client not found: ${clientId}`);

  const existing = await storage.getPoliciesByClient(clientId, orgId);
  const duplicate = existing.find((p) => p.productVersionId === productVersionId && p.status !== "cancelled");
  if (duplicate) {
    console.log(`   ⚠ Skipped — client already has policy ${duplicate.policyNumber} for this product`);
    return duplicate;
  }

  const dependents = await storage.getDependentsByClient(clientId, orgId);
  const dependentDobs = dependents.map((d) => d.dateOfBirth || null);
  const premiumAmount = await computePolicyPremium(
    orgId,
    productVersionId,
    currency,
    "monthly",
    [],
    [],
    1 + dependents.length,
    dependentDobs,
  );

  const policyNumber = await storage.generatePolicyNumber(orgId);
  const memberRows: Array<{ clientId?: string | null; dependentId?: string | null; role: string }> = [
    { clientId, role: "policy_holder" },
    ...dependents.map((d) => ({ dependentId: d.id, role: "dependent" as const })),
  ];

  const { policy } = await storage.createPolicyWithInitialSetup(orgId, {
    policy: {
      organizationId: orgId,
      clientId,
      productVersionId,
      policyNumber,
      status: "inactive",
      currency,
      premiumAmount,
      paymentSchedule: "monthly",
      effectiveDate: new Date().toISOString().split("T")[0],
      beneficiaryFirstName: client.firstName,
      beneficiaryLastName: client.lastName,
      beneficiaryRelationship: "SELF",
      beneficiaryNationalId: client.nationalId,
      beneficiaryPhone: client.phone,
    },
    statusHistory: {
      fromStatus: null,
      toStatus: "inactive",
      reason: `Simulated issue (${label})`,
      changedBy: null,
    },
    members: memberRows,
    addOnIds: [],
  });

  console.log(`   ✅ Policy issued: ${policy.policyNumber}`);
  console.log(`      Status: ${policy.status} | Premium: ${policy.currency} ${policy.premiumAmount}/month`);
  console.log(`      Client: ${client.firstName} ${client.lastName} (${client.id})`);
  console.log(`      Members: ${memberRows.length} (holder + ${dependents.length} dependent(s))`);
  return policy;
}

async function main() {
  const mode = parseMode();
  const orgId = await resolveOrgId();
  const dedicated = await orgUsesDedicatedDatabase(orgId);
  console.log(`Database: ${dedicated ? "dedicated tenant DB" : "shared registry DB"}`);
  const { productVersionId, productName, currency } = await resolveActiveProductVersion(orgId);
  console.log(`Product: ${productName} | Version: ${productVersionId} | Currency: ${currency}`);
  console.log(`Mode: ${mode}\n`);

  const results: { scenario: string; policyNumber?: string; clientId?: string; skipped?: boolean }[] = [];

  if (mode === "both" || mode === "lead") {
    console.log("─── Scenario 1: Existing lead (client without policy) ───");
    const lead = await findLeadClient(orgId);
    if (!lead) {
      if (shouldSeedLead()) {
        console.log("   No lead found — creating demo lead client (no policy yet)...");
        const demo = await createSimClient(orgId, "LEAD");
        console.log(`   Demo lead: ${demo.firstName} ${demo.lastName} (${demo.id})`);
        const policy = await issuePolicyForClient(orgId, demo.id, productVersionId, currency, "seeded-lead");
        results.push({ scenario: "lead", policyNumber: policy.policyNumber, clientId: demo.id });
      } else {
        console.log("   No lead found (all clients already have policies). Use --seed-lead to create one.");
        results.push({ scenario: "lead", skipped: true });
      }
    } else {
      console.log(`   Lead: ${lead.name} (${lead.id})`);
      const policy = await issuePolicyForClient(orgId, lead.id, productVersionId, currency, "existing-lead");
      results.push({ scenario: "lead", policyNumber: policy.policyNumber, clientId: lead.id });
    }
    console.log("");
  }

  if (mode === "both" || mode === "new") {
    console.log("─── Scenario 2: Brand-new client ───");
    const suffix = Date.now().toString(36).toUpperCase();
    const newClient = await createSimClient(orgId, suffix);
    console.log(`   Created client: ${newClient.firstName} ${newClient.lastName} (${newClient.id})`);
    console.log(`   National ID: ${newClient.nationalId} | Phone: ${newClient.phone}`);
    const policy = await issuePolicyForClient(orgId, newClient.id, productVersionId, currency, "new-client");
    results.push({ scenario: "new", policyNumber: policy.policyNumber, clientId: newClient.id });
    console.log("");
  }

  console.log("─── Summary ───");
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.scenario}: skipped (no lead available)`);
    } else {
      console.log(`  ${r.scenario}: policy ${r.policyNumber} → client ${r.clientId}`);
    }
  }

  const issued = results.filter((r) => r.policyNumber).length;
  process.exit(issued > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
