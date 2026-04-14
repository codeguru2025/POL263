import { storage } from "./storage";
import { structuredLog } from "./logger";

export function auditLog(req: any, action: string, entityType: string, entityId: string | undefined, before: any, after: any, orgIdOverride?: string) {
  const user = req.user as any;
  const organizationId = orgIdOverride || user?.organizationId;
  if (!organizationId) {
    structuredLog("warn", "auditLog skipped — no organizationId", { action, entityType, entityId, userId: user?.id });
    return Promise.resolve(undefined as any);
  }
  return storage.createAuditLog({
    organizationId,
    actorId: user?.id,
    actorEmail: user?.email,
    action,
    entityType,
    entityId,
    before,
    after,
    requestId: req.requestId,
  }).catch((err: any) => {
    structuredLog("error", "auditLog write failed", { error: err?.message, action, entityType, entityId });
  });
}

export function safeError(err: any): string {
  if (process.env.NODE_ENV === "production") return "Internal server error";
  return err?.message || "Internal server error";
}

export function getAddOnPrice(ao: any, paymentSchedule: string): number {
  if (ao.pricingMode === "percentage") {
    return parseFloat(String(ao.priceAmount ?? ao.priceMonthly ?? 0));
  }
  if (paymentSchedule === "weekly" && ao.priceWeekly) {
    return parseFloat(String(ao.priceWeekly));
  }
  if (paymentSchedule === "biweekly" && ao.priceBiweekly) {
    return parseFloat(String(ao.priceBiweekly));
  }
  return parseFloat(String(ao.priceMonthly ?? ao.priceAmount ?? 0));
}

function ageAt(dateOfBirth: string | null | undefined, asOf = new Date()): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDelta = asOf.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < birth.getDate())) age -= 1;
  return age;
}

function monthlyToScheduleFactor(paymentSchedule: string): number {
  if (paymentSchedule === "weekly") return 12 / 52;
  if (paymentSchedule === "biweekly") return 12 / 26;
  if (paymentSchedule === "quarterly") return 3;
  if (paymentSchedule === "annually") return 12;
  return 1;
}

export async function computePolicyPremium(
  orgId: string,
  productVersionId: string,
  currency: string,
  paymentSchedule: string,
  addOnIds: string[],
  memberAddOns?: { memberRef: string; addOnId: string }[],
  memberCount?: number,
  dependentDateOfBirths?: (string | null | undefined)[],
): Promise<string> {
  const pv = await storage.getProductVersion(productVersionId, orgId);
  if (!pv) return "0";
  const product = await storage.getProduct(pv.productId, orgId);
  let base = 0;
  if (paymentSchedule === "monthly") {
    base = currency === "ZAR" ? parseFloat(String(pv.premiumMonthlyZar ?? 0)) : parseFloat(String(pv.premiumMonthlyUsd ?? 0));
  } else if (paymentSchedule === "weekly") {
    base = currency === "ZAR" ? parseFloat(String((pv as any).premiumWeeklyZar ?? 0)) : parseFloat(String(pv.premiumWeeklyUsd ?? 0));
  } else if (paymentSchedule === "biweekly") {
    base = currency === "ZAR" ? parseFloat(String((pv as any).premiumBiweeklyZar ?? 0)) : parseFloat(String(pv.premiumBiweeklyUsd ?? 0));
  }

  let addOnTotal = 0;
  const orgAddOns = await storage.getAddOns(orgId);

  if (memberAddOns && memberAddOns.length > 0) {
    for (const ma of memberAddOns) {
      const ao = orgAddOns.find((a: any) => a.id === ma.addOnId);
      if (!ao) continue;
      const price = getAddOnPrice(ao, paymentSchedule);
      if (ao.pricingMode === "percentage") {
        addOnTotal += base * (price / 100);
      } else {
        addOnTotal += price;
      }
    }
  } else if (addOnIds.length > 0) {
    const count = memberCount || 1;
    for (const id of addOnIds) {
      const ao = orgAddOns.find((a: any) => a.id === id);
      if (!ao) continue;
      const price = getAddOnPrice(ao, paymentSchedule);
      if (ao.pricingMode === "percentage") {
        addOnTotal += base * (price / 100) * count;
      } else {
        addOnTotal += price * count;
      }
    }
  }

  let dependantSurcharge = 0;
  if (product) {
    const includedAdults = Number(product.maxAdults ?? 2);
    const includedChildren = Number(product.maxChildren ?? 4);
    const childThresholdAge = Number(pv.dependentMaxAge ?? 20);
    const adultRateMonthly = parseFloat(String(pv.underwriterAmountAdult ?? 0));
    const childRateMonthly = parseFloat(String(pv.underwriterAmountChild ?? pv.underwriterAmountAdult ?? 0));

    let adults = 1; // Policy holder.
    let children = 0;
    for (const dob of dependentDateOfBirths || []) {
      const age = ageAt(dob ?? null);
      if (age === null || age >= childThresholdAge) adults += 1;
      else children += 1;
    }

    const extraAdults = Math.max(0, adults - includedAdults);
    const extraChildren = Math.max(0, children - includedChildren);
    const monthlySurcharge = (extraAdults * adultRateMonthly) + (extraChildren * childRateMonthly);
    dependantSurcharge = monthlySurcharge * monthlyToScheduleFactor(paymentSchedule);
  }

  const totalRaw = base + addOnTotal + dependantSurcharge;
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : 0;
  return total.toFixed(2);
}

export async function recordAgentCommission(orgId: string, policy: any, transactionId: string, paymentAmount: string) {
  if (!policy.agentId) return;
  try {
    let firstMonths = 0, firstRate = 0, recurringStart = 0, recurringRate = 0;
    let sourceLabel = "org plan";

    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, orgId);
      if (pv?.commissionFirstMonthsRate != null) {
        firstMonths = Number(pv.commissionFirstMonthsCount) || 2;
        firstRate = Number(pv.commissionFirstMonthsRate) || 0;
        recurringStart = Number(pv.commissionRecurringStartMonth) || firstMonths + 1;
        recurringRate = Number(pv.commissionRecurringRate) || 0;
        sourceLabel = "product version";
      }
    }

    if (firstRate === 0 && recurringRate === 0) {
      const plans = await storage.getCommissionPlans(orgId);
      const activePlan = plans.find((p) => p.isActive);
      if (!activePlan) return;
      firstMonths = Number(activePlan.firstMonthsCount) || 2;
      firstRate = Number(activePlan.firstMonthsRate) || 50;
      recurringStart = Number(activePlan.recurringStartMonth) || 5;
      recurringRate = Number(activePlan.recurringRate) || 10;
      sourceLabel = "org plan";
    }

    const existingPayments = await storage.getPaymentsByPolicy(policy.id, orgId);
    const clearedCount = existingPayments.filter((p: any) => p.status === "cleared").length;

    let rate = 0;
    let entryType = "recurring";
    if (clearedCount <= firstMonths) {
      rate = firstRate;
      entryType = "first_months";
    } else {
      rate = recurringRate;
      entryType = "recurring";
    }

    if (rate <= 0) return;

    const amount = (parseFloat(paymentAmount) * rate / 100).toFixed(2);
    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      transactionId,
      entryType,
      amount,
      currency: policy.currency || "USD",
      description: `${rate}% commission on payment #${clearedCount} (${entryType === "first_months" ? "initial" : "recurring"}, ${sourceLabel})`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Commission calculation failed", { error: (err as Error).message, policyId: policy.id });
  }
}

export async function recordClawback(orgId: string, policy: any, reason: string) {
  if (!policy.agentId) return;
  try {
    let clawbackThreshold = 4;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, orgId);
      if (pv?.commissionClawbackThreshold != null) clawbackThreshold = Number(pv.commissionClawbackThreshold);
    }
    if (clawbackThreshold <= 0) return;
    const existingPayments = await storage.getPaymentsByPolicy(policy.id, orgId);
    const clearedCount = existingPayments.filter((p: any) => p.status === "cleared").length;
    if (clearedCount > clawbackThreshold) return;
    const earned = await storage.getCommissionEntriesByPolicy(policy.id, orgId);
    const unreversed = earned.filter((e: any) => e.status === "earned").reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
    if (unreversed <= 0) return;
    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      transactionId: undefined,
      entryType: "clawback",
      amount: (-Math.abs(unreversed)).toFixed(2),
      currency: policy.currency || "USD",
      description: `Clawback — ${reason} within ${clawbackThreshold}-month threshold (${clearedCount} payments)`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Clawback recording failed", { error: (err as Error).message, policyId: policy.id });
  }
}

export async function rollbackClawbacks(orgId: string, policy: any) {
  if (!policy.agentId) return;
  try {
    const entries = await storage.getCommissionEntriesByPolicy(policy.id, orgId);
    const unreversed = entries
      .filter((e: any) => e.entryType === "clawback" && e.status === "earned")
      .reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
    if (unreversed >= 0) return;
    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      transactionId: undefined,
      entryType: "clawback_reversal",
      amount: Math.abs(unreversed).toFixed(2),
      currency: policy.currency || "USD",
      description: `Rollback — policy reinstated, clawback reversed`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Rollback recording failed", { error: (err as Error).message, policyId: policy.id });
  }
}

export async function enforceAgentScope(req: any, filters: any): Promise<any> {
  const user = req.user as any;
  if (!user) return filters;
  if (user.isPlatformOwner) return filters;
  const perms = await storage.getUserEffectivePermissions(user.id);
  if (perms.includes("read:report") || perms.includes("read:finance")) return filters;
  const userRoles = await storage.getUserRoles(user.id, user.organizationId);
  const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
  if (isAgent) return { ...filters, agentId: user.id };
  return filters;
}
