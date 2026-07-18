import { apiJson } from "./client";

export interface ClientPolicy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
  paymentSchedule: string;
  totalPaid: string;
  totalDue: string;
  balance: string;
  outstanding: string;
  walletBalance: string;
  periodsElapsed: number;
  beneficiaryFirstName: string | null;
  beneficiaryLastName: string | null;
  beneficiaryRelationship: string | null;
}

/** server/client-auth.ts:331 — session-scoped to the logged-in client, balance/arrears
 *  computed server-side from real payment history + the credit-balance wallet. */
export async function getMyPolicies(): Promise<ClientPolicy[]> {
  return apiJson("/api/client-auth/policies");
}

export interface PolicyMember {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth: string | null;
}

export async function getPolicyMembers(policyId: string): Promise<PolicyMember[]> {
  return apiJson(`/api/client-auth/policies/${policyId}/members`);
}

export interface Beneficiary {
  firstName: string;
  lastName: string;
  relationship: string | null;
  nationalId: string | null;
  phone: string | null;
  dependentId: string | null;
}

export async function getBeneficiary(policyId: string): Promise<Beneficiary | null> {
  return apiJson(`/api/client-auth/policies/${policyId}/beneficiary`);
}

export async function setBeneficiary(policyId: string, input: { firstName: string; lastName: string; relationship?: string; nationalId?: string; phone?: string }): Promise<void> {
  await apiJson(`/api/client-auth/policies/${policyId}/beneficiary`, { method: "PUT", body: JSON.stringify(input) });
}

export async function removeBeneficiary(policyId: string): Promise<void> {
  await apiJson(`/api/client-auth/policies/${policyId}/beneficiary`, { method: "DELETE" });
}

// Policy document / receipt PDF viewing is deliberately NOT in this pass. The document
// endpoint is session-cookie-gated; Linking.openURL would hand the URL to an external
// browser that doesn't carry this app's cookie jar, so a naive "open the URL" approach
// would just 401. Doing this properly needs an in-app authenticated fetch + a local file
// write (expo-file-system) + a share/open sheet (expo-sharing) -- a real feature, not a
// one-line addition, deferred to a later pass rather than shipped broken.
