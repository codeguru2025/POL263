/**
 * Reports → Policies → Activations. Pure — no DB.
 *
 * Every time a policy became active is one of five different things, and only one of them is a
 * new policy starting to pay. Sep 2026 at Falakhe: 255 "activations" = 32 first payments + 144
 * legacy captures + 73 late payers back from grace + 5 reinstatements + 1 correction. The old
 * Conversions (inactive→active, legacy included) and Reinstatements tabs were slices of this.
 */
import { toCents, fromCents } from "@shared/money";

export type ActivationType = "first_payment" | "legacy_capture" | "back_from_grace" | "reinstated" | "reactivated" | "correction";

export const ACTIVATION_TYPES: ActivationType[] = ["first_payment", "legacy_capture", "back_from_grace", "reinstated", "reactivated", "correction"];

export const ACTIVATION_TYPE_LABEL: Record<ActivationType, string> = {
  first_payment: "First payment (new)",
  legacy_capture: "Legacy (existing client)",
  back_from_grace: "Back from grace",
  reinstated: "Reinstated (was lapsed)",
  reactivated: "Reactivated (was cancelled)",
  correction: "Correction",
};

export function classifyActivation(fromStatus: string | null | undefined, isLegacy: boolean): ActivationType {
  switch (fromStatus) {
    // An existing paper client typed in as a legacy policy (auto-activated on capture, or on its
    // first POL263 payment) is data capture, not a new policy starting to pay.
    case "inactive": return isLegacy ? "legacy_capture" : "first_payment";
    case "grace": return "back_from_grace";
    case "lapsed": return "reinstated";
    case "cancelled":
    case "archived": return "reactivated";
    default: return "correction"; // active→active, or no previous status recorded
  }
}

export interface ActivationRowLike {
  type: ActivationType;
  premium: string;
  currency: string;
}

/** One activation, as storage.getActivationsReport returns it. */
export interface ActivationReportRow extends ActivationRowLike {
  id: string;
  policyId: string;
  policyNumber: string;
  clientName: string;
  phone: string;
  productName: string;
  agentId: string | null;
  agentName: string;
  groupName: string;
  fromStatus: string | null;
  /** ISO timestamp of the status change. */
  activatedAt: string;
  /** Tenant-local calendar day of the status change. */
  activatedOn: string;
  reason: string;
  currentStatus: string;
  isLegacy: boolean;
  /** The payment behind it: the policy's receipt, or its group's lump-sum receipt. */
  paymentDate: string;
  paymentAmount: string;
  paymentCurrency: string;
  paymentReceiptNumber: string;
  paymentSource: "receipt" | "group" | null;
}

export interface ActivationsSummary {
  total: number;
  byType: Record<ActivationType, number>;
  /** Premium of the new policies that started paying, per currency. */
  firstPaymentPremium: Record<string, string>;
}

export function summarizeActivations(rows: ActivationRowLike[]): ActivationsSummary {
  const byType = Object.fromEntries(ACTIVATION_TYPES.map((t) => [t, 0])) as Record<ActivationType, number>;
  const cents: Record<string, number> = {};
  for (const r of rows) {
    byType[r.type]++;
    if (r.type === "first_payment") {
      const cur = r.currency || "USD";
      cents[cur] = (cents[cur] ?? 0) + toCents(r.premium);
    }
  }
  return {
    total: rows.length,
    byType,
    firstPaymentPremium: Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, fromCents(v)])),
  };
}
