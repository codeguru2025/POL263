import { apiJson } from "./client";

export interface Policy {
  id: string;
  policyNumber: string;
  clientId: string;
  productVersionId: string;
  status: string;
  currency: string;
  premiumAmount: string;
  paymentSchedule: string;
  createdAt: string;
}

/** Server-side agent-scoping (server/routes.ts:2449), same pattern as leads/clients. */
export async function getPolicies(): Promise<Policy[]> {
  return apiJson("/api/policies?limit=500");
}

export interface Beneficiary {
  firstName: string;
  lastName: string;
  relationship: string;
  nationalId: string;
  phone: string;
}

export interface CreatePolicyInput {
  clientId: string;
  productVersionId: string;
  currency: "USD" | "ZAR" | "ZIG";
  paymentSchedule: "monthly" | "weekly" | "biweekly";
  addOnIds?: string[];
  beneficiary: Beneficiary;
}

/** Mirrors server/routes.ts:2568's contract exactly — required fields verified against
 *  source, not guessed. Scoped for this pass to the common case: the client themselves
 *  plus whatever dependents they already have on file (server defaults to that when
 *  `members` is omitted) — no ad-hoc member/dependent picker yet. Premium isn't
 *  previewed client-side (no preview endpoint exists — the server is the only source of
 *  truth for the age-band/add-on calculation), it's read back from the response. */
export async function createPolicy(input: CreatePolicyInput): Promise<Policy> {
  return apiJson("/api/policies", { method: "POST", body: JSON.stringify(input) });
}
