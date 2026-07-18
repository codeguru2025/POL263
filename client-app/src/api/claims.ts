import { apiJson } from "./client";

export interface Claim {
  id: string;
  claimNumber: string;
  policyId: string;
  claimType: string;
  status: string;
  deceasedName: string | null;
  deceasedRelationship: string | null;
  dateOfDeath: string | null;
  causeOfDeath: string | null;
  createdAt: string;
}

export async function getMyClaims(): Promise<Claim[]> {
  return apiJson("/api/client-auth/claims");
}

export const CLAIM_TYPES = ["death", "accidental_death", "disability", "repatriation", "cash_in_lieu"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export interface SubmitClaimInput {
  policyId: string;
  claimType: ClaimType;
  deceasedName?: string;
  deceasedRelationship?: string;
  dateOfDeath?: string;
  causeOfDeath?: string;
}

export async function submitClaim(input: SubmitClaimInput): Promise<Claim> {
  return apiJson("/api/client-auth/claims", { method: "POST", body: JSON.stringify(input) });
}
