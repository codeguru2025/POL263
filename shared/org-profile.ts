/**
 * Tenant business-profile taxonomy, captured at onboarding (organizations.orgType / .productTypes
 * / .distributionChannels). Grounded in IPEC (Zimbabwe)'s actual classes of insurance business
 * (life assurance, funeral assurance, short-term, composite, microinsurance) plus the informal/
 * non-underwritten categories this platform also serves (funeral service providers, burial
 * societies, informal savings/cash clubs) that fall outside IPEC's capital-regulated classes.
 *
 * orgType and productTypes are deliberately separate axes: orgType is who the tenant is
 * (regulatory/business identity, drives defaults and compliance framing); productTypes is what
 * they actually sell (drives which product builder(s) and claims workflow activate). A funeral
 * services company and a funeral assurer can both have productTypes including funeral_cash_plan.
 */

export const ORG_TYPES = [
  "life_assurer",
  "funeral_assurer",
  "microinsurer",
  "composite",
  "funeral_services",
  "burial_society",
  "cash_club",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  life_assurer: "Life Assurer",
  funeral_assurer: "Funeral Assurer",
  microinsurer: "Microinsurer",
  composite: "Composite Insurer",
  funeral_services: "Funeral Services Company",
  burial_society: "Burial Society",
  cash_club: "Cash Club / Informal Savings Group",
};

/**
 * Which "builder" (server/product-builders/ once built) each product type belongs to:
 *   risk      — premium in, claim out (existing engine, generalized)
 *   accumulation — contribution in, fund balance grows, maturity/vesting payout (new engine)
 *   none      — funeral_services orgs with no underwritten product of their own
 */
export const PRODUCT_TYPES = [
  "funeral_cash_plan",
  "whole_life",
  "hospital_cash",
  "credit_protection",
  "livestock_agri_index",
  "education_protect",
  "pension_savings",
  "investment",
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  funeral_cash_plan: "Funeral Cash Plan",
  whole_life: "Whole Life Cover",
  hospital_cash: "Hospital Cash Back",
  credit_protection: "Credit Protection",
  livestock_agri_index: "Livestock / Agri-Index Protect",
  education_protect: "Education Protect",
  pension_savings: "Pension Savings",
  investment: "Investment",
};

export const PRODUCT_TYPE_ENGINE: Record<ProductType, "risk" | "accumulation"> = {
  funeral_cash_plan: "risk",
  whole_life: "risk",
  hospital_cash: "risk",
  credit_protection: "risk",
  livestock_agri_index: "risk",
  education_protect: "accumulation",
  pension_savings: "accumulation",
  investment: "accumulation",
};

export const DISTRIBUTION_CHANNELS = ["agents", "brokers", "digital_self_service"] as const;
export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

export const DISTRIBUTION_CHANNEL_LABELS: Record<DistributionChannel, string> = {
  agents: "Own Agents",
  brokers: "Brokers",
  digital_self_service: "Digital / Self-Service",
};
