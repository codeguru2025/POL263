export interface PremiumPreviewResult {
  total: string;
  base: number;
  addOnTotal: number;
  dependantSurcharge: number;
  additionalMemberCount: number;
  totalIncluded: number;
  additionalRateMonthly: number;
  totalMembers: number;
}

export interface PremiumPreviewInputs {
  selectedVersion: any;
  selectedProduct: any;
  currency: string;
  paymentSchedule: string;
  memberAddOns: Record<string, string[]>;
  beneficiaryDependentIds: string[];
  dependents: any[] | undefined;
  addOns: any[] | undefined;
}

/**
 * Client-side premium preview — mirrors the server's authoritative computePolicyPremium
 * (server/route-helpers.ts) closely enough for the create-policy wizard to show a live
 * estimate before submit. This is a mechanical extraction of the original inline useMemo
 * body from policies.tsx (pre-split); the calculation itself was not altered during the
 * split — see tests/unit/policy-premium-preview.test.ts for cross-checks against the
 * server function.
 */
export function calculatePremiumPreview(inputs: PremiumPreviewInputs): PremiumPreviewResult | null {
  const { selectedVersion, selectedProduct, currency, paymentSchedule, memberAddOns, beneficiaryDependentIds, dependents, addOns } = inputs;
  if (!selectedVersion) return null;
  // Client-side preview only — the authoritative premium is computed server-side by
  // computePolicyPremium (server/route-helpers.ts). Suffix picks USD/ZAR/ZiG the same way.
  const suffix = currency === "ZAR" ? "Zar" : currency === "ZIG" ? "Zig" : "Usd";
  let base = 0;
  if (paymentSchedule === "monthly") {
    base = parseFloat((selectedVersion as any)[`premiumMonthly${suffix}`] || "0");
  } else if (paymentSchedule === "weekly") {
    base = parseFloat((selectedVersion as any)[`premiumWeekly${suffix}`] || "0");
  } else if (paymentSchedule === "biweekly") {
    base = parseFloat((selectedVersion as any)[`premiumBiweekly${suffix}`] || "0");
  }
  if (base === 0) return null;

  const getAoPrice = (ao: any) => {
    if (ao.pricingMode === "percentage") return parseFloat(ao.priceAmount || ao.priceMonthly || "0");
    if (paymentSchedule === "weekly" && ao.priceWeekly) return parseFloat(ao.priceWeekly);
    if (paymentSchedule === "biweekly" && ao.priceBiweekly) return parseFloat(ao.priceBiweekly);
    return parseFloat(ao.priceMonthly || ao.priceAmount || "0");
  };

  let addOnTotal = 0;
  const allMemberAddOns = Object.values(memberAddOns).flat();
  if (addOns && allMemberAddOns.length > 0) {
    for (const aoId of allMemberAddOns) {
      const ao = addOns.find((a: any) => a.id === aoId);
      if (!ao) continue;
      const price = getAoPrice(ao);
      if (ao.pricingMode === "percentage") {
        addOnTotal += base * (price / 100);
      } else {
        addOnTotal += price;
      }
    }
  }
  const scheduleFactor = paymentSchedule === "weekly"
    ? (12 / 52)
    : paymentSchedule === "biweekly"
    ? (12 / 26)
    : paymentSchedule === "quarterly"
    ? 3
    : paymentSchedule === "annually"
    ? 12
    : 1;
  const childThresholdAge = Number(selectedVersion.dependentMaxAge ?? 20);
  const maxAdults = Number(selectedProduct?.maxAdults ?? 2);
  const maxChildren = Number(selectedProduct?.maxChildren ?? 4);
  const maxExtended = Number((selectedProduct as any)?.maxExtendedMembers ?? 0);

  let adults = 1; // Policy holder always counts as one adult.
  let children = 0;
  const selectedDependentSet = new Set(beneficiaryDependentIds);
  for (const dep of dependents || []) {
    if (!selectedDependentSet.has(dep.id)) continue;
    const dob = dep.dateOfBirth ? new Date(dep.dateOfBirth) : null;
    if (!dob || Number.isNaN(dob.getTime())) {
      adults += 1;
      continue;
    }
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age >= childThresholdAge) adults += 1;
    else children += 1;
  }

  // Use the dedicated additional-member rate if set; otherwise fall back to
  // underwriter rates (mirrors the backend computePolicyPremium logic exactly).
  const additionalMemberSuffix = currency === "ZAR" ? "Zar" : currency === "ZIG" ? "Zig" : "Usd";
  const additionalRateMonthly = parseFloat(String(
    (selectedVersion as any)[`additionalMemberPremiumMonthly${additionalMemberSuffix}`] || "0"
  ));

  let dependantSurcharge = 0;
  let additionalMemberCount = 0;
  const totalIncluded = maxAdults + maxChildren + maxExtended;
  if (additionalRateMonthly > 0) {
    additionalMemberCount = Math.max(0, (adults + children) - totalIncluded);
    dependantSurcharge = additionalMemberCount * additionalRateMonthly * scheduleFactor;
  } else {
    const adultRateMonthly = parseFloat(String(selectedVersion.underwriterAmountAdult || "0"));
    const childRateMonthly = parseFloat(String(selectedVersion.underwriterAmountChild || selectedVersion.underwriterAmountAdult || "0"));
    const extraAdults = Math.max(0, adults - maxAdults);
    const extraChildren = Math.max(0, children - maxChildren);
    dependantSurcharge = ((extraAdults * adultRateMonthly) + (extraChildren * childRateMonthly)) * scheduleFactor;
  }

  const total = (base + addOnTotal + dependantSurcharge).toFixed(2);
  return { total, base, addOnTotal, dependantSurcharge, additionalMemberCount, totalIncluded, additionalRateMonthly, totalMembers: adults + children };
}
