/**
 * Customer-Service chatbot integration (SMSALA WhatsApp bot "Pol263 Customer Service").
 *
 *   Phase 1 — authentication:  the smallest secure server-to-server auth layer for the bot to
 *             call POL263. POL263 has no generic API-key mechanism, so this reuses — exactly —
 *             the pattern already established for outbound SMS credentials (server/sms-config.ts):
 *               • one control_plane.tenant_integrations row per tenant, provider
 *                 "customer_service"
 *               • the shared secret is AES-256-GCM encrypted at rest with
 *                 TENANT_CONFIG_ENCRYPTION_KEY (server/tenant-config-crypto.ts)
 *               • the SECRET identifies the tenant — the caller never supplies an
 *                 organization_id and X-Tenant-ID is ignored — so a leaked/guessed request can
 *                 never reach another tenant's data.
 *
 *   Phase 2 — customer verification:  a READ-ONLY check that a supplied
 *             (policy_number, identity_number, phone_number) triple all belong to the same
 *             policyholder within the authenticated tenant. Composes the existing storage
 *             helpers only (getPolicyByNumber + getClient) — no new query, no schema change.
 *
 * NOTHING here creates a Pol263 session. A successful verification returns a short-lived
 * (15 min), AES-256-GCM encrypted, opaque, stateless verification token that later phases can
 * require in place of re-sending the customer's raw identifiers. It is NOT a login and grants
 * no access on its own.
 *
 * Provisioning / rotation:  script/provision-customer-service-credential.ts (console-only).
 *
 * Legacy-customer limitation (documented, deliberate): clients.nationalId and clients.phone are
 * both nullable. A customer whose record is missing either field cannot pass this strict
 * three-way check and receives a generic { verified: false }. There is intentionally no fallback
 * verification path in this phase — it will be designed separately.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import { decryptFields, encryptFields, encryptSecret, decryptSecret } from "./tenant-config-crypto";
import { normalizeNationalId } from "@shared/validation";
import type { Policy } from "@shared/schema";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { platformAuditLog } from "./route-helpers";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireVerifiedCustomer() — the authenticated customer-service caller: the tenant
       *  (from the shared secret) and the verified customer (from the verification token). */
      customerService?: { orgId: string; clientId: string; verifiedPolicyId: string };
    }
  }
}

/** control_plane.tenant_integrations.provider value for this integration. */
export const CUSTOMER_SERVICE_PROVIDER_KEY = "customer_service";

/** Verification-token lifetime. Matches the `expires_in` returned to the caller. */
export const VERIFICATION_TOKEN_TTL_SECONDS = 900;

/**
 * Minimum time (ms) every /verify response takes, whatever the outcome — mirrors
 * server/client-auth.ts's constantTimeResponse (which is private to that file and must not be
 * touched). Flattens the coarse timing signal between "no such policy", "policy exists but
 * details wrong", and "verified". A single indexed lookup is <5ms, i.e. <2.5% of this floor,
 * so the residual signal is negligible.
 */
const RESPONSE_TIME_FLOOR_MS = 220;

const GENERIC_VERIFICATION_FAILURE = "We could not verify the details provided.";

interface CustomerServiceConfigShape {
  sharedSecret?: string;
}

// ─── crypto helpers ───────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Constant-time string equality via fixed-length SHA-256 digests (timingSafeEqual needs equal
 *  lengths, and hashing first avoids leaking the secret's length). */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── verification token (stateless, AES-256-GCM encrypted, opaque) ────────────

export interface VerificationTokenClaims {
  orgId: string;
  clientId: string;
  policyId: string;
}

/**
 * Issue a short-lived opaque token. The claims are AES-256-GCM encrypted (via the existing
 * tenant-config-crypto helper, keyed by TENANT_CONFIG_ENCRYPTION_KEY) then base64url-wrapped, so
 * the caller sees an opaque string — no raw database IDs, no readable payload — that it simply
 * echoes back on later calls. GCM makes it tamper-evident; the embedded `exp` makes it expire.
 */
export function issueVerificationToken(claims: VerificationTokenClaims): { token: string; expiresIn: number } {
  const exp = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ o: claims.orgId, c: claims.clientId, p: claims.policyId, exp });
  const token = Buffer.from(encryptSecret(payload), "utf8").toString("base64url");
  return { token, expiresIn: VERIFICATION_TOKEN_TTL_SECONDS };
}

/** Decrypt + validate a token from issueVerificationToken. Returns the claims, or null if the
 *  token is malformed, fails authentication, or has expired. For use by later phases. */
export function verifyCustomerServiceToken(token: string): VerificationTokenClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  let decrypted: string;
  try {
    decrypted = decryptSecret(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  let payload: any;
  try {
    payload = JSON.parse(decrypted);
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.o !== "string" || typeof payload.c !== "string" || typeof payload.p !== "string") return null;
  return { orgId: payload.o, clientId: payload.c, policyId: payload.p };
}

// ─── tenant credential storage (control plane) ────────────────────────────────

/** All active customer-service integration rows, with the shared secret decrypted.
 *  Errors are swallowed to a generic failure by the caller — they must never leak. */
export async function loadActiveCustomerServiceIntegrations(): Promise<{ tenantId: string; sharedSecret: string }[]> {
  const rows = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.provider, CUSTOMER_SERVICE_PROVIDER_KEY), eq(tenantIntegrations.isActive, true)));
  return rows.map((r: any) => {
    const cfg = decryptFields(r.config as CustomerServiceConfigShape, ["sharedSecret"]);
    return { tenantId: r.tenantId as string, sharedSecret: cfg.sharedSecret || "" };
  });
}

/** Generate a new shared secret (256 bits, url-safe). */
export function generateSharedSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Create or rotate a tenant's shared secret. Encrypts before it touches the database. */
export async function upsertCustomerServiceCredential(orgId: string, sharedSecret: string): Promise<void> {
  const [existing] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, CUSTOMER_SERVICE_PROVIDER_KEY)))
    .limit(1);
  const config = encryptFields({ sharedSecret }, ["sharedSecret"]);
  if (existing) {
    await cpDb
      .update(tenantIntegrations)
      .set({ config, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
  } else {
    await cpDb.insert(tenantIntegrations).values({ tenantId: orgId, provider: CUSTOMER_SERVICE_PROVIDER_KEY, isActive: true, config });
  }
}

/** Status only — never returns the secret itself. */
export async function getCustomerServiceCredentialStatus(orgId: string): Promise<{ configured: boolean; isActive: boolean }> {
  const [row] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, CUSTOMER_SERVICE_PROVIDER_KEY)))
    .limit(1);
  if (!row) return { configured: false, isActive: false };
  const cfg = decryptFields((row as any).config as CustomerServiceConfigShape, ["sharedSecret"]);
  return { configured: !!cfg.sharedSecret, isActive: (row as any).isActive };
}

// ─── request authentication ──────────────────────────────────────────────────

function extractBearerSecret(req: Request): string {
  const header = (req.headers?.authorization ?? "") as string;
  const m = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return m ? m[1].trim() : "";
}

/**
 * Authenticate an inbound customer-service request purely from the bearer shared secret and
 * resolve the one tenant it belongs to. Returns null on any failure (no secret, unknown secret,
 * control plane unreachable). NEVER logs or echoes the secret. NEVER reads organization_id /
 * X-Tenant-ID from the request.
 */
export async function authenticateCustomerServiceRequest(req: Request): Promise<{ orgId: string } | null> {
  const presented = extractBearerSecret(req);
  if (!presented) return null;

  let rows: { tenantId: string; sharedSecret: string }[];
  try {
    rows = await loadActiveCustomerServiceIntegrations();
  } catch (err) {
    structuredLog("error", "CUSTOMER_SERVICE_INTEGRATION_LOAD_FAILED", { error: (err as Error).message });
    return null;
  }

  let matched: string | null = null;
  for (const row of rows) {
    // Compare against every row (no early break) so response time doesn't hint at how many
    // tenants are configured or which position matched.
    if (row.sharedSecret && constantTimeEqual(presented, row.sharedSecret)) {
      matched = row.tenantId;
    }
  }
  return matched ? { orgId: matched } : null;
}

// ─── customer verification (read-only) ───────────────────────────────────────

const digitsOnly = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Same rule storage.getClientByPhone already uses: compare the last 9 digits. */
function phoneMatches(stored: string | null | undefined, supplied: unknown): boolean {
  const a = digitsOnly(stored);
  const b = digitsOnly(supplied);
  if (a.length < 9 || b.length < 9) return false;
  return a.slice(-9) === b.slice(-9);
}

function nationalIdMatches(stored: string | null | undefined, supplied: unknown): boolean {
  const a = normalizeNationalId(stored ?? null);
  const b = normalizeNationalId(typeof supplied === "string" ? supplied : null);
  return !!a && !!b && a === b;
}

export interface VerifyCustomerInput {
  policyNumber: unknown;
  identityNumber: unknown;
  phoneNumber: unknown;
}

export type VerifyCustomerResult =
  | { verified: false }
  | {
      verified: true;
      clientId: string;
      policyId: string;
      customerName: string;
      policyNumber: string;
      policyStatus: string;
    };

/**
 * The core check, scoped to exactly one tenant. Resolves the policy first (so a shared/duplicate
 * national ID can never surface the wrong person), then confirms the supplied ID and phone match
 * that policy's own client. Strict path only.
 */
export async function verifyCustomer(orgId: string, input: VerifyCustomerInput): Promise<VerifyCustomerResult> {
  const policyNumber = String(input.policyNumber ?? "").trim().toUpperCase();
  if (!policyNumber) return { verified: false };

  const policy = await storage.getPolicyByNumber(policyNumber, orgId);
  if (!policy || !policy.clientId || policy.organizationId !== orgId) return { verified: false };

  const client = await storage.getClient(policy.clientId, orgId);
  if (!client || client.organizationId !== orgId) return { verified: false };

  // Legacy-customer limitation: no ID or no phone on file → cannot verify via the strict path.
  if (!client.nationalId || !client.phone) return { verified: false };

  if (!nationalIdMatches(client.nationalId, input.identityNumber)) return { verified: false };
  if (!phoneMatches(client.phone, input.phoneNumber)) return { verified: false };

  const customerName = [client.title, client.firstName, client.lastName].filter(Boolean).join(" ").trim();
  return {
    verified: true,
    clientId: client.id,
    policyId: policy.id,
    customerName,
    policyNumber: policy.policyNumber,
    policyStatus: policy.status, // raw database value, never transformed
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

/**
 * POST /api/customer-service/verify
 *
 * Auth:   Authorization: Bearer <per-tenant shared secret>
 * Body:   { policy_number, identity_number, phone_number }   (all strings, required)
 * CSRF:   exempt (see server/index.ts CSRF_EXEMPT_PATHS) — the bearer secret is the sole gate.
 *
 * Responses:
 *   401 { error: "unauthorized" }            — missing/invalid credential
 *   400 { error: "invalid_request" }         — malformed body (only reachable once authenticated)
 *   200 { verified: false, message }         — could not verify (no detail on which field / whether the policy exists)
 *   200 { verified: true, verification_token, expires_in,
 *         customer: { name }, policy: { policy_number, status } }
 */
export async function handleVerifyRequest(req: Request, res: Response): Promise<Response> {
  const startedAt = Date.now();
  const respond = async (status: number, body: unknown): Promise<Response> => {
    const remaining = RESPONSE_TIME_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
    return res.status(status).json(body);
  };

  const auth = await authenticateCustomerServiceRequest(req);
  if (!auth) {
    structuredLog("warn", "CUSTOMER_SERVICE_VERIFY_AUTH_FAILED", { requestId: (req as any).requestId, ip: req.ip });
    await platformAuditLog(req, "CUSTOMER_SERVICE_VERIFY_AUTH_FAILED", "CustomerServiceIntegration", undefined, null, null);
    return respond(401, { error: "unauthorized" });
  }
  const { orgId } = auth;

  const body: any = req.body ?? {};
  const policyNumber = body.policy_number;
  const identityNumber = body.identity_number;
  const phoneNumber = body.phone_number;
  const allPresent = [policyNumber, identityNumber, phoneNumber].every((v) => typeof v === "string" && v.trim().length > 0);
  if (!allPresent) {
    return respond(400, { error: "invalid_request" });
  }

  let result: VerifyCustomerResult;
  try {
    result = await verifyCustomer(orgId, { policyNumber, identityNumber, phoneNumber });
  } catch (err) {
    structuredLog("error", "CUSTOMER_SERVICE_VERIFY_ERROR", {
      orgId,
      requestId: (req as any).requestId,
      error: (err as Error).message,
    });
    return respond(200, { verified: false, message: GENERIC_VERIFICATION_FAILURE });
  }

  if (!result.verified) {
    structuredLog("info", "CUSTOMER_SERVICE_VERIFY_RESULT", { orgId, verified: false, requestId: (req as any).requestId, ip: req.ip });
    await platformAuditLog(req, "CUSTOMER_SERVICE_VERIFY", "CustomerServiceIntegration", orgId, null, { verified: false });
    return respond(200, { verified: false, message: GENERIC_VERIFICATION_FAILURE });
  }

  const { token, expiresIn } = issueVerificationToken({
    orgId,
    clientId: result.clientId,
    policyId: result.policyId,
  });
  structuredLog("info", "CUSTOMER_SERVICE_VERIFY_RESULT", { orgId, verified: true, requestId: (req as any).requestId, ip: req.ip });
  await platformAuditLog(req, "CUSTOMER_SERVICE_VERIFY", "CustomerServiceIntegration", orgId, null, {
    verified: true,
    policyId: result.policyId,
  });

  return respond(200, {
    verified: true,
    verification_token: token,
    expires_in: expiresIn,
    customer: { name: result.customerName },
    policy: { policy_number: result.policyNumber, status: result.policyStatus },
  });
}

// ─── customer-session middleware (shared secret + verification token) ─────────

/** Canonical JSON error bodies for every /api/customer-service/* endpoint. */
export const CS_ERROR = {
  unauthorized: { error: "unauthorized" as const },
  forbidden: { error: "forbidden" as const },
  not_found: { error: "not_found" as const },
  invalid_request: { error: "invalid_request" as const },
};

/**
 * Gate for every /api/customer-service/* route EXCEPT /verify.
 *
 *   1. Authenticate the tenant shared secret (Authorization: Bearer …).
 *   2. Read + decrypt the verification token (X-Verification-Token header).
 *   3. Confirm token.orgId === the secret's orgId.
 *   4. Attach req.customerService = { orgId, clientId, verifiedPolicyId }.
 *
 * Any failure → 401 { error: "unauthorized" }. The tenant NEVER comes from the body, query,
 * params, or an arbitrary header — only from the decrypted credential and token.
 */
export async function requireVerifiedCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await authenticateCustomerServiceRequest(req);
  if (!auth) {
    structuredLog("warn", "CUSTOMER_SERVICE_AUTH_FAILED", { requestId: (req as any).requestId, ip: req.ip, reason: "secret" });
    res.status(401).json(CS_ERROR.unauthorized);
    return;
  }

  const token = req.header("X-Verification-Token") || "";
  const claims = verifyCustomerServiceToken(token);
  if (!claims) {
    structuredLog("warn", "CUSTOMER_SERVICE_AUTH_FAILED", { requestId: (req as any).requestId, ip: req.ip, orgId: auth.orgId, reason: "token" });
    res.status(401).json(CS_ERROR.unauthorized);
    return;
  }

  if (claims.orgId !== auth.orgId) {
    structuredLog("warn", "CUSTOMER_SERVICE_AUTH_FAILED", { requestId: (req as any).requestId, ip: req.ip, reason: "org_mismatch" });
    res.status(401).json(CS_ERROR.unauthorized);
    return;
  }

  req.customerService = { orgId: auth.orgId, clientId: claims.clientId, verifiedPolicyId: claims.policyId };
  next();
}

/**
 * CLIENT-scoped ownership check for any :policyId route. Loads the verified client's own policies
 * (inherently org+client scoped — `getPoliciesByClient(clientId, orgId)`) and returns the one
 * matching `policyRef` by id OR policy number. Returns null if the customer doesn't own it, which
 * the caller turns into 403 — never revealing whether the policy exists for another client/tenant.
 */
export async function assertPolicyBelongsToVerifiedClient(
  policyRef: string,
  ctx: { orgId: string; clientId: string },
): Promise<Policy | null> {
  if (!policyRef || typeof policyRef !== "string") return null;
  const policies = await storage.getPoliciesByClient(ctx.clientId, ctx.orgId);
  const ref = policyRef.trim();
  const refUpper = ref.toUpperCase();
  const match = policies.find((p) => p.id === ref || (p.policyNumber && p.policyNumber.toUpperCase() === refUpper));
  if (!match) return null;
  // Belt-and-braces — getPoliciesByClient already constrains both, but assert explicitly.
  if (match.clientId !== ctx.clientId || match.organizationId !== ctx.orgId) return null;
  return match;
}

/**
 * Exchange a still-valid verification token for a fresh 15-minute one, preserving orgId, clientId
 * and policyId. Returns null if the presented token is missing, tampered, or expired (an expired
 * token can never be refreshed), or if the token's tenant does not match `expectedOrgId` (the
 * tenant resolved from the shared secret) — the secret and the token must be the same tenant,
 * exactly as requireVerifiedCustomer enforces for every other endpoint.
 */
export function refreshVerificationToken(
  token: string,
  expectedOrgId: string,
): { token: string; expiresIn: number } | null {
  const claims = verifyCustomerServiceToken(token);
  if (!claims) return null;
  if (claims.orgId !== expectedOrgId) return null;
  return issueVerificationToken({ orgId: claims.orgId, clientId: claims.clientId, policyId: claims.policyId });
}

/** Exposed for unit tests only. */
export const __test = { constantTimeEqual, phoneMatches, nationalIdMatches, extractBearerSecret, RESPONSE_TIME_FLOOR_MS };
