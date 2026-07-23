/**
 * Technical/engine-level discriminator for the risk & protection product builder (Phase 3 of
 * the multi-vertical platform work — see shared/org-profile.ts for the business-level
 * "productTypes" a tenant says it sells, which is a related but distinct concept: a business
 * product type maps to one of these engine shapes when an actual `products` row gets built).
 *
 * Two independent axes, mirroring how computePolicyPremium already thinks about a policy:
 *   - benefitTrigger: what event pays out (death is the only one the engine has ever handled)
 *   - insuredEntityType: what's covered (a person/household is the only one it's ever handled)
 *
 * Both null on a `products` row means "today's funeral-cash-plan shape" — the only shape that
 * has ever existed — so every consumer must treat null exactly like {death, person_household},
 * never as "unknown/show nothing."
 */

export const BENEFIT_TRIGGERS = [
  "death",
  "hospitalization",
  "credit_default",
  "index_threshold",
  "livestock_mortality",
] as const;
export type BenefitTrigger = (typeof BENEFIT_TRIGGERS)[number];

export const BENEFIT_TRIGGER_LABELS: Record<BenefitTrigger, string> = {
  death: "Death",
  hospitalization: "Hospitalization (per-day benefit)",
  credit_default: "Credit Default",
  index_threshold: "Index Threshold (e.g. weather/agri-index)",
  livestock_mortality: "Livestock Mortality",
};

export const INSURED_ENTITY_TYPES = ["person_household", "asset", "account"] as const;
export type InsuredEntityType = (typeof INSURED_ENTITY_TYPES)[number];

export const INSURED_ENTITY_TYPE_LABELS: Record<InsuredEntityType, string> = {
  person_household: "Person / Household",
  asset: "Insured Asset (e.g. livestock)",
  account: "Account (e.g. credit facility)",
};

/** A product with null/undefined benefitTrigger is a funeral-cash-plan-shaped product — the
 *  only shape that existed before this field was added. Always resolve through this helper
 *  rather than reading product.benefitTrigger directly, so "null means death" stays centralized. */
export function resolveBenefitTrigger(benefitTrigger: BenefitTrigger | null | undefined): BenefitTrigger {
  return benefitTrigger ?? "death";
}

export function resolveInsuredEntityType(insuredEntityType: InsuredEntityType | null | undefined): InsuredEntityType {
  return insuredEntityType ?? "person_household";
}
