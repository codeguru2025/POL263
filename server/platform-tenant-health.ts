/**
 * Cross-tenant health rollup for the platform-owner "Tenant Health" dashboard.
 * Every signal here is derived from data that already exists — no new error/event
 * logging infrastructure. Reuses the batched per-tenant loop pattern already proven
 * by GET /api/platform/dashboard (server/routes.ts) and storage.getPlatformRevenueSummary
 * (already currency-grouped — never blend USD/ZAR/ZIG into one number).
 */
import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, tenantSubscriptions, billingPlans, backupSyncRuns, tenantIntegrations } from "@shared/control-plane-schema";
import { getDbForOrg } from "./tenant-db";
import { db } from "./db";
import { organizations, policies, paymentAutomationRuns, platformReceivables } from "@shared/schema";
import { storage } from "./storage";

const TENANT_HEALTH_BATCH = 5;
const FEE_OVERDUE_DAYS = 30;
const AUTOMATION_FAILURE_WARNING_THRESHOLD = 5;

export interface TenantHealthIssue {
  severity: "critical" | "warning";
  code: string;
  message: string;
}

export interface TenantHealthRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  licenseStatus: string;
  subscription: { status: string | null; planName: string | null; currentPeriodEnd: string | null };
  policies: { active: number; grace: number; lapsed: number };
  fees: { due: Record<string, string>; settled: Record<string, string> };
  paynowConfigured: boolean;
  automationFailuresLast7d: number;
  issues: TenantHealthIssue[];
  loadError: string | null;
}

export async function buildTenantHealth(): Promise<{
  summary: { tenants: number; activeSubscriptions: number; pastDue: number; feesDue: Record<string, string>; feesSettled: Record<string, string> };
  tenants: TenantHealthRow[];
}> {
  const tenantRows = await cpDb
    .select({ id: cpTenants.id, name: cpTenants.name, slug: cpTenants.slug, isActive: cpTenants.isActive, licenseStatus: cpTenants.licenseStatus })
    .from(cpTenants)
    .where(eq(cpTenants.isActive, true));
  const activeTenants = tenantRows.filter((t) => !t.name.includes("(deleted)"));
  const tenantIds = activeTenants.map((t) => t.id);

  const subRows = tenantIds.length
    ? await cpDb.select({
        tenantId: tenantSubscriptions.tenantId,
        status: tenantSubscriptions.status,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        planId: tenantSubscriptions.planId,
      }).from(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, tenantIds))
    : [];
  const planIds = Array.from(new Set(subRows.map((s) => s.planId)));
  const planRows = planIds.length
    ? await cpDb.select({ id: billingPlans.id, name: billingPlans.name }).from(billingPlans).where(inArray(billingPlans.id, planIds))
    : [];
  const planNameById = new Map(planRows.map((p) => [p.id, p.name]));
  const subByTenant = new Map(subRows.map((s) => [s.tenantId, s]));

  // PayNow credentials can live in either of two places (see server/paynow-config.ts):
  // the control-plane's encrypted tenant_integrations table (where the platform-owner
  // "Configure" screen actually reads/writes via getOrgPaynowConfig/upsertOrgPaynowConfig —
  // the current path for any tenant configured recently), or the legacy plaintext columns on
  // the shared organizations table (pre-migration tenants). Checking only the legacy columns
  // here previously caused tenants configured through the control plane to be incorrectly
  // flagged as "not configured".
  const [orgRows, paynowIntegrationRows] = tenantIds.length
    ? await Promise.all([
        db.select({
          id: organizations.id,
          paynowIntegrationId: organizations.paynowIntegrationId,
          paynowIntegrationKey: organizations.paynowIntegrationKey,
        }).from(organizations).where(inArray(organizations.id, tenantIds)),
        cpDb.select({ tenantId: tenantIntegrations.tenantId, config: tenantIntegrations.config })
          .from(tenantIntegrations)
          .where(and(inArray(tenantIntegrations.tenantId, tenantIds), eq(tenantIntegrations.provider, "paynow"), eq(tenantIntegrations.isActive, true))),
      ])
    : [[], []];
  const legacyConfiguredByTenant = new Map(orgRows.map((o) => [o.id, !!(o.paynowIntegrationId && o.paynowIntegrationKey)]));
  const controlPlaneConfiguredByTenant = new Map(paynowIntegrationRows.map((r) => {
    const cfg = r.config as { integrationId?: string; integrationKey?: string } | null;
    return [r.tenantId, !!(cfg?.integrationId && cfg?.integrationKey)];
  }));
  const paynowConfiguredByTenant = new Map(
    tenantIds.map((id) => [id, controlPlaneConfiguredByTenant.get(id) || legacyConfiguredByTenant.get(id) || false])
  );

  // Backup sync runs are platform-wide (one run covers every tenant DB), not per-tenant rows —
  // errors[] entries are "orgName:table: message" strings, so per-tenant matching below is
  // necessarily best-effort by tenant name, not a clean join.
  const [latestBackupRun] = await cpDb.select().from(backupSyncRuns).orderBy(desc(backupSyncRuns.startedAt)).limit(1);
  const backupErrorLines: string[] = Array.isArray(latestBackupRun?.errors) ? (latestBackupRun!.errors as string[]) : [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const feeOverdueThreshold = new Date(Date.now() - FEE_OVERDUE_DAYS * 24 * 60 * 60 * 1000);

  const perTenant: TenantHealthRow[] = [];
  for (let i = 0; i < activeTenants.length; i += TENANT_HEALTH_BATCH) {
    const batch = activeTenants.slice(i, i + TENANT_HEALTH_BATCH);
    const batchResults = await Promise.all(batch.map(async (tenant): Promise<TenantHealthRow> => {
      const sub = subByTenant.get(tenant.id);
      const subscription = {
        status: sub?.status ?? null,
        planName: sub ? planNameById.get(sub.planId) ?? null : null,
        currentPeriodEnd: sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null,
      };
      const paynowConfigured = paynowConfiguredByTenant.get(tenant.id) ?? false;

      try {
        const tdb = await getDbForOrg(tenant.id);
        const [{ activeCount }] = await tdb.select({ activeCount: count() }).from(policies).where(and(eq(policies.organizationId, tenant.id), eq(policies.status, "active")));
        const [{ graceCount }] = await tdb.select({ graceCount: count() }).from(policies).where(and(eq(policies.organizationId, tenant.id), eq(policies.status, "grace")));
        const [{ lapsedCount }] = await tdb.select({ lapsedCount: count() }).from(policies).where(and(eq(policies.organizationId, tenant.id), eq(policies.status, "lapsed")));
        const [{ failedCount }] = await tdb.select({ failedCount: count() }).from(paymentAutomationRuns).where(and(
          eq(paymentAutomationRuns.organizationId, tenant.id),
          eq(paymentAutomationRuns.status, "failed"),
          gte(paymentAutomationRuns.createdAt, sevenDaysAgo)
        ));
        const [{ oldUnsettledCount }] = await tdb.select({ oldUnsettledCount: count() }).from(platformReceivables).where(and(
          eq(platformReceivables.organizationId, tenant.id),
          eq(platformReceivables.isSettled, false),
          lt(platformReceivables.createdAt, feeOverdueThreshold)
        ));
        const feeSummary = await storage.getPlatformRevenueSummary(tenant.id);

        const issues: TenantHealthIssue[] = [];
        if (subscription.status === "past_due" || subscription.status === "suspended") {
          issues.push({ severity: "critical", code: `subscription_${subscription.status}`, message: `Subscription is ${subscription.status.replace("_", " ")}` });
        }
        if (oldUnsettledCount > 0) {
          issues.push({ severity: "critical", code: "fees_overdue", message: `${oldUnsettledCount} platform fee${oldUnsettledCount === 1 ? "" : "s"} unsettled for over ${FEE_OVERDUE_DAYS} days` });
        }
        if (lapsedCount > 0) {
          issues.push({ severity: "warning", code: "lapsed_policies", message: `${lapsedCount} lapsed polic${lapsedCount === 1 ? "y" : "ies"}` });
        }
        if (failedCount > AUTOMATION_FAILURE_WARNING_THRESHOLD) {
          issues.push({ severity: "warning", code: "automation_failures", message: `${failedCount} payment automation failures in the last 7 days` });
        }
        if (tenant.isActive && !paynowConfigured) {
          issues.push({ severity: "warning", code: "paynow_not_configured", message: "PayNow is not configured for this tenant" });
        }
        if (backupErrorLines.some((line) => line.startsWith(`${tenant.name}:`))) {
          issues.push({ severity: "warning", code: "backup_sync_error", message: "Latest backup sync reported an error for this tenant (best-effort match by name)" });
        }

        return {
          id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive, licenseStatus: tenant.licenseStatus,
          subscription,
          policies: { active: activeCount, grace: graceCount, lapsed: lapsedCount },
          fees: { due: feeSummary.totalDue, settled: feeSummary.totalSettled },
          paynowConfigured,
          automationFailuresLast7d: failedCount,
          issues,
          loadError: null,
        };
      } catch (err: any) {
        return {
          id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive, licenseStatus: tenant.licenseStatus,
          subscription,
          policies: { active: 0, grace: 0, lapsed: 0 },
          fees: { due: {}, settled: {} },
          paynowConfigured,
          automationFailuresLast7d: 0,
          issues: [{ severity: "critical", code: "load_failed", message: err?.message || "Failed to load tenant health metrics" }],
          loadError: err?.message || "Failed to load tenant health metrics",
        };
      }
    }));
    perTenant.push(...batchResults);
  }

  // Flagged tenants first: critical > warning > clean.
  const severityRank = (t: TenantHealthRow) =>
    t.issues.some((i) => i.severity === "critical") ? 0 : t.issues.length > 0 ? 1 : 2;
  perTenant.sort((a, b) => severityRank(a) - severityRank(b));

  const feesDue: Record<string, number> = {};
  const feesSettled: Record<string, number> = {};
  for (const t of perTenant) {
    for (const [cur, amt] of Object.entries(t.fees.due)) feesDue[cur] = (feesDue[cur] || 0) + parseFloat(amt);
    for (const [cur, amt] of Object.entries(t.fees.settled)) feesSettled[cur] = (feesSettled[cur] || 0) + parseFloat(amt);
  }
  const round2 = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([cur, amt]) => [cur, amt.toFixed(2)]));

  return {
    summary: {
      tenants: perTenant.length,
      activeSubscriptions: perTenant.filter((t) => t.subscription.status === "active").length,
      pastDue: perTenant.filter((t) => t.subscription.status === "past_due" || t.subscription.status === "suspended").length,
      feesDue: round2(feesDue),
      feesSettled: round2(feesSettled),
    },
    tenants: perTenant,
  };
}
