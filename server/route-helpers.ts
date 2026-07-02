import { storage } from "./storage";
import { structuredLog } from "./logger";
import { isAgentScoped } from "@shared/roles";
import { eq, and } from "drizzle-orm";
import { commissionLedgerEntries } from "@shared/schema";
import { notifyUser } from "./user-notifications";

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
    ipAddress: req.ip || (req.socket as any)?.remoteAddress || null,
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

/**
 * Rate for one additional (chargeable) member, by age band. "Child" uses this product
 * version's own dependentMaxAge cutoff; the rest split into 21-65 / 66-84 / 85+.
 */
function ageBandRate(pv: any, currency: string, age: number | null, childThresholdAge: number): number {
  const pick = (usdField: string, zarField: string) =>
    parseFloat(String((currency === "ZAR" ? pv[zarField] : pv[usdField]) ?? 0));
  if (age !== null && age < childThresholdAge) {
    return pick("additionalMemberRateChildUsd", "additionalMemberRateChildZar");
  }
  if (age !== null && age >= 85) return pick("additionalMemberRate85PlusUsd", "additionalMemberRate85PlusZar");
  if (age !== null && age >= 66) return pick("additionalMemberRate66To84Usd", "additionalMemberRate66To84Zar");
  return pick("additionalMemberRate21To65Usd", "additionalMemberRate21To65Zar");
}

function hasAgeBandRates(pv: any): boolean {
  return [
    pv.additionalMemberRateChildUsd, pv.additionalMemberRateChildZar,
    pv.additionalMemberRate21To65Usd, pv.additionalMemberRate21To65Zar,
    pv.additionalMemberRate66To84Usd, pv.additionalMemberRate66To84Zar,
    pv.additionalMemberRate85PlusUsd, pv.additionalMemberRate85PlusZar,
  ].some((v) => v != null);
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
    const includedExtended = Number(product.maxExtendedMembers ?? 0);
    const childThresholdAge = Number(pv.dependentMaxAge ?? 20);

    let adults = 1; // Policy holder.
    let children = 0;
    for (const dob of dependentDateOfBirths || []) {
      const age = ageAt(dob ?? null);
      if (age === null || age >= childThresholdAge) adults += 1;
      else children += 1;
    }

    // Dedicated client-facing additional-member rates (set by admin on product version)
    const additionalRateUsd = parseFloat(String(pv.additionalMemberPremiumMonthlyUsd ?? 0));
    const additionalRateZar = parseFloat(String(pv.additionalMemberPremiumMonthlyZar ?? 0));
    const additionalRate = currency === "ZAR" ? additionalRateZar : additionalRateUsd;

    if (hasAgeBandRates(pv)) {
      // Age-band behaviour: each member beyond the product's included count is priced
      // individually by their own age band, instead of one flat additional-member rate.
      // Members are covered for free in the order they were added (policy holder first);
      // whichever were added last are the ones counted as "additional" once the included
      // count is exceeded.
      const totalIncluded = includedAdults + includedChildren + includedExtended;
      const ages: (number | null)[] = [null, ...((dependentDateOfBirths || []).map((dob) => ageAt(dob ?? null)))];
      const extraCount = Math.max(0, ages.length - totalIncluded);
      if (extraCount > 0) {
        const chargeableAges = ages.slice(ages.length - extraCount);
        const perMemberTotal = chargeableAges.reduce((sum: number, age) => sum + ageBandRate(pv, currency, age, childThresholdAge), 0);
        dependantSurcharge = perMemberTotal * monthlyToScheduleFactor(paymentSchedule);
      }
    } else if (additionalRate > 0) {
      // Flat behaviour: single per-additional-member rate, counting ALL excess over the
      // product's covered count (adults + children + extended family).
      const totalIncluded = includedAdults + includedChildren + includedExtended;
      const extraTotal = Math.max(0, (adults + children) - totalIncluded);
      dependantSurcharge = extraTotal * additionalRate * monthlyToScheduleFactor(paymentSchedule);
    } else {
      // Legacy behaviour: use underwriter rates per member type (backwards compatible).
      const adultRateMonthly = parseFloat(String(pv.underwriterAmountAdult ?? 0));
      const childRateMonthly = parseFloat(String(pv.underwriterAmountChild ?? pv.underwriterAmountAdult ?? 0));
      const extraAdults = Math.max(0, adults - includedAdults);
      const extraChildren = Math.max(0, children - includedChildren);
      const monthlySurcharge = (extraAdults * adultRateMonthly) + (extraChildren * childRateMonthly);
      dependantSurcharge = monthlySurcharge * monthlyToScheduleFactor(paymentSchedule);
    }
  }

  const totalRaw = base + addOnTotal + dependantSurcharge;
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : 0;
  return total.toFixed(2);
}

// ─── Billing / arrears helpers ──────────────────────────────────────────────

const PERIOD_DAYS: Record<string, number> = {
  weekly: 7, biweekly: 14, quarterly: 91.31, annually: 365.25, monthly: 30.44,
};
export function periodDaysForSchedule(schedule: string | null | undefined): number {
  return PERIOD_DAYS[String(schedule || "monthly")] ?? 30.44;
}

/** Whole billing periods elapsed between two dates for a schedule (floor; non-positive spans ⇒ 0). */
export function periodsBetween(
  from: string | Date | null | undefined,
  to: string | Date,
  schedule: string | null | undefined,
): number {
  if (!from) return 0;
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return 0;
  const days = (t.getTime() - f.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 0) return 0;
  return Math.floor(days / periodDaysForSchedule(schedule));
}

export interface OutstandingResult {
  periodsElapsed: number;
  totalDue: number;
  totalPaid: number;
  walletBalance: number;
  /** Amount owed right now (>= 0). */
  outstanding: number;
  /** Signed account balance: positive = paid ahead / credit, negative = owed. */
  balance: number;
}

/**
 * Single source of truth for a policy's outstanding/arrears figure. Reproduces the
 * legacy formula (periodsElapsed × current premium − totalPaid) and folds in the
 * signed credit-balance wallet, which carries premium-change reconciliations
 * (negative = arrears charged, positive = advance credit) and overpayments.
 */
export function computePolicyOutstanding(params: {
  policy: any;
  totalPaid: number;
  walletBalance?: number;
}): OutstandingResult {
  const { policy } = params;
  const totalPaid = Number(params.totalPaid) || 0;
  const walletBalance = Number(params.walletBalance) || 0;
  const premium = parseFloat(String(policy?.premiumAmount ?? "0")) || 0;
  const startDate = policy?.inceptionDate || policy?.effectiveDate;

  let periodsElapsed = 0;
  let totalDue = 0;
  if (startDate && premium > 0) {
    const start = new Date(startDate);
    const now = new Date();
    if (!Number.isNaN(start.getTime()) && start <= now) {
      const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      periodsElapsed = Math.ceil(daysElapsed / periodDaysForSchedule(policy?.paymentSchedule));
      totalDue = periodsElapsed * premium;
    }
  }

  const balance = totalPaid + walletBalance - totalDue;
  const outstanding = Math.max(0, -balance);
  return { periodsElapsed, totalDue, totalPaid, walletBalance, outstanding, balance };
}

/**
 * Reconciles a premium-affecting change. Charges/credits only the DIFFERENCE
 * (delta × whole periods since the effective date) to the signed credit-balance
 * wallet — arrears make it negative (owed), advances make it positive (credit) —
 * and records an audit row. Returns the signed reconciliation amount and periods.
 * The caller is responsible for persisting the new premiumAmount on the policy.
 */
export async function reconcilePremiumChange(params: {
  orgId: string;
  policy: any;
  oldPremium: number | string;
  newPremium: number | string;
  effectiveDate: string;
  changeType: "upgrade" | "downgrade" | "member_add" | "member_remove" | "manual";
  reason?: string | null;
  actorId?: string | null;
}): Promise<{ reconciliation: number; periods: number; direction: "arrears" | "credit" | "none" }> {
  const { orgId, policy } = params;
  const oldP = parseFloat(String(params.oldPremium)) || 0;
  const newP = parseFloat(String(params.newPremium)) || 0;
  const currency = policy?.currency || "USD";
  const periods = periodsBetween(params.effectiveDate, new Date(), policy?.paymentSchedule);
  const R = Number(((newP - oldP) * periods).toFixed(2)); // signed: + = arrears owed, - = overpaid

  if (Math.abs(R) >= 0.01) {
    // Post the inverse to the wallet: arrears (R>0) ⇒ wallet down (owed); advance (R<0) ⇒ wallet up (credit).
    await storage.addPolicyCreditBalance(orgId, policy.id, (-R).toFixed(2), currency);
  }

  try {
    await storage.createPolicyPremiumChange({
      organizationId: orgId,
      policyId: policy.id,
      oldPremium: oldP.toFixed(2),
      newPremium: newP.toFixed(2),
      currency,
      effectiveDate: params.effectiveDate,
      periods,
      reconciliation: R.toFixed(2),
      changeType: params.changeType,
      reason: params.reason ?? null,
      actorId: params.actorId ?? null,
    });
  } catch (err) {
    structuredLog("error", "createPolicyPremiumChange failed", { policyId: policy.id, error: (err as Error).message });
  }

  const direction = R > 0 ? "arrears" : R < 0 ? "credit" : "none";
  return { reconciliation: R, periods, direction };
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
    // Notify agent of commission earned
    notifyUser(orgId, policy.agentId, {
      type: "COMMISSION_EARNED",
      title: "Commission Earned",
      body: `${policy.currency || "USD"} ${amount} commission credited for policy ${policy.policyNumber || policy.id}.`,
      metadata: { policyId: policy.id, transactionId, amount, currency: policy.currency || "USD" },
    }).catch(() => {});
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

export async function rollbackClawbacksInTx(txDb: any, orgId: string, policy: any) {
  if (!policy.agentId) return;
  try {
    const entries = await txDb.select().from(commissionLedgerEntries)
      .where(and(eq(commissionLedgerEntries.policyId, policy.id), eq(commissionLedgerEntries.organizationId, orgId)));
    const unreversed = entries
      .filter((e: any) => e.entryType === "clawback" && e.status === "earned")
      .reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
    if (unreversed >= 0) return;
    await txDb.insert(commissionLedgerEntries).values({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
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

/**
 * Converts empty-string values to null for the specified fields.
 * Use before passing req.body to storage update methods for any column
 * that is a date, timestamp, or uuid in PostgreSQL — those types reject "".
 */
export function nullifyEmptyFields(body: Record<string, any>, fields: string[]): Record<string, any> {
  const out = { ...body };
  for (const f of fields) {
    if (out[f] === "") out[f] = null;
  }
  return out;
}

export function handleZodError(err: any, res: any): boolean {
  if (err?.name === "ZodError") {
    res.status(400).json({ message: "Invalid data", errors: err.errors });
    return true;
  }
  return false;
}

export async function enforceAgentScope(req: any, filters: any): Promise<any> {
  const user = req.user as any;
  if (!user) return filters;
  if (user.isPlatformOwner) return filters;
  const userRoles = await storage.getUserRoles(user.id, user.organizationId);
  // Use the canonical scope gate so an admin/manager who also holds the agent role
  // (e.g. for a referral code) is NOT restricted to only their own data.
  const isAgent = isAgentScoped(userRoles as { name: string }[]);
  if (isAgent) return { ...filters, agentId: user.id };
  return filters;
}

/**
 * Enforces agent access control for a specific policy.
 * Agents can only access policies they are assigned to.
 * Returns an object with access status and error response if denied.
 */
export type PolicyAccessResult<T> =
  | { hasAccess: true; policy: T }
  | { hasAccess: false; errorResponse: { status: number; json: { message: string } } };

export async function enforceAgentPolicyAccess<T extends { organizationId?: string | null; agentId?: string | null }>(
  req: any,
  policy: T | undefined | null,
): Promise<PolicyAccessResult<T>> {
  const user = req.user as any;
  if (!user || !policy) return { hasAccess: false, errorResponse: { status: 404, json: { message: "Policy not found" } } };

  if (policy.organizationId !== user.organizationId) {
    return { hasAccess: false, errorResponse: { status: 404, json: { message: "Policy not found" } } };
  }

  if (user.isPlatformOwner) return { hasAccess: true, policy };

  const userRoles = await storage.getUserRoles(user.id, user.organizationId);
  // A user who holds the "agent" role AND a superior role (administrator, manager,
  // superuser) must NOT be scoped down to only their own policies — isAgentScoped()
  // is the canonical gate used across routes.ts. The previous naive `r.name === "agent"`
  // check denied admins who also carried an agent role (e.g. for a referral code).
  const isAgent = isAgentScoped(userRoles as { name: string }[]);

  if (isAgent && policy.agentId !== user.id) {
    return { hasAccess: false, errorResponse: { status: 403, json: { message: "Access denied" } } };
  }

  return { hasAccess: true, policy };
}
