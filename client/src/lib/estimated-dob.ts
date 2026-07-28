/**
 * Converts a rough age estimate into a placeholder date of birth (Jan 1 of the inferred birth
 * year) for pricing purposes ONLY — never persisted as a dependent's real date of birth.
 * computePolicyPremium/recommendProducts (server) already just consume a DOB string, so this is
 * purely an input-layer fallback for whichever surface collects it (vCard quote flow, staff
 * "Issue New Policy" wizard) when an exact DOB isn't known yet. The real DOB is still required
 * before the dependent record / policy is actually saved.
 */
export function estimatedDobFromAge(age: number): string {
  const birthYear = new Date().getFullYear() - Math.max(0, Math.round(age));
  return `${birthYear}-01-01`;
}

/** Resolves whichever of exact DOB / estimated age was supplied to the DOB string used for
 *  pricing. Returns null if neither was given. */
export function resolveDobForQuote(dateOfBirth: string, estimatedAge: string): string | null {
  if (dateOfBirth) return dateOfBirth;
  const age = parseInt(estimatedAge, 10);
  if (Number.isFinite(age) && age >= 0) return estimatedDobFromAge(age);
  return null;
}
