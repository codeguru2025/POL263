/**
 * Pricing formulas for the mortuary service rate card (mortuaryServiceRates /
 * caseServiceCharges). Shared so the client can live-preview a charge before submitting and
 * the server can recompute the same number authoritatively — the server never trusts a
 * client-sent amount.
 */

export interface ServiceRateLike {
  pricingType: string;
  baseAmount: string | number;
  perKmRate?: string | number | null;
  tierGroupSize?: number | null;
  tierGroupPrice?: string | number | null;
}

export interface ServiceChargeInput {
  quantity?: number;
  distanceKm?: number;
}

export function computeServiceCharge(rate: ServiceRateLike, input: ServiceChargeInput): number {
  const qty = input.quantity ?? 1;
  if (rate.pricingType === "per_km") {
    const base = parseFloat(String(rate.baseAmount)) || 0;
    const perKm = parseFloat(String(rate.perKmRate ?? "0")) || 0;
    return base + perKm * (input.distanceKm ?? 0);
  }
  if (rate.pricingType === "tiered_group") {
    const groupSize = rate.tierGroupSize && rate.tierGroupSize > 0 ? rate.tierGroupSize : 1;
    const groupPrice = parseFloat(String(rate.tierGroupPrice ?? "0")) || 0;
    const groups = Math.ceil(qty / groupSize);
    return groups * groupPrice;
  }
  // flat
  const base = parseFloat(String(rate.baseAmount)) || 0;
  return base * qty;
}
