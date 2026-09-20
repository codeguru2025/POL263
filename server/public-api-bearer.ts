import crypto from "crypto";

/**
 * Lets a trusted server-to-server caller skip CSRF on specific /api/public/* write routes by
 * presenting `Authorization: Bearer <PUBLIC_API_BEARER_TOKEN>`. These routes (POST /api/public/
 * quote, /api/public/register-policy, /api/public/agent-vcard/:refCode/quote-lead) have no
 * session-based auth of their own — refCode is a routing key, not a secret (see
 * resolveVcardOrgId in server/routes.ts) — so unlike the customer-service API's blanket CSRF
 * exemption, CSRF stays required for everyone by default; a valid bearer token is a positive,
 * narrowly-scoped alternative, not a removal of the check. Inert (never matches) until an
 * operator sets PUBLIC_API_BEARER_TOKEN.
 */

const PUBLIC_API_BEARER_PATH_PREFIXES = ["/api/public/agent-vcard/"];
const PUBLIC_API_BEARER_EXACT_PATHS = ["/api/public/quote", "/api/public/register-policy"];

export function isPublicApiBearerPath(path: string): boolean {
  return PUBLIC_API_BEARER_EXACT_PATHS.includes(path) || PUBLIC_API_BEARER_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function hasValidPublicApiBearerToken(authorizationHeader: string | undefined, configuredToken: string | undefined): boolean {
  if (!configuredToken) return false;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) return false;
  const provided = authorizationHeader.slice("Bearer ".length);
  const providedBuf = Buffer.from(provided, "utf8");
  const configuredBuf = Buffer.from(configuredToken, "utf8");
  if (providedBuf.length !== configuredBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, configuredBuf);
}
