/**
 * Customer self-service write operations, shared by the client portal (server/client-auth.ts)
 * and the customer-service API (server/customer-service-routes.ts).
 *
 * These functions were extracted verbatim from the inline handlers in client-auth.ts so the
 * business logic — claim-number allocation via org_policy_sequences, CLM-NNNNNN formatting,
 * claims + claim_status_history insertion in one transaction, beneficiary column writes — lives
 * in exactly one place. Behaviour for the client portal is unchanged (the default `source`
 * reproduces the previous claim_status_history reason string exactly).
 *
 * Callers are responsible for authenticating the customer; every function still re-checks that
 * the target policy belongs to `clientId` within `orgId`.
 */
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { withOrgTransaction, getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { claims, claimStatusHistory, policyMembers, insertClaimSchema, type Claim, type Policy } from "@shared/schema";

/** 400-class: bad/missing input from the customer. */
export class CustomerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerInputError";
  }
}
/** 403-class: the customer tried to act on a resource that isn't theirs. */
export class CustomerForbiddenError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "CustomerForbiddenError";
  }
}

export interface SubmitClaimInput {
  policyId?: unknown;
  claimType?: unknown;
  deceasedName?: unknown;
  deceasedRelationship?: unknown;
  dateOfDeath?: unknown;
  causeOfDeath?: unknown;
}

/**
 * Submit a claim on behalf of an authenticated client. Extracted from client-auth.ts's
 * `POST /api/client-auth/claims`. `source` only affects the claim_status_history reason text;
 * the default keeps the client-portal string identical to before.
 */
export async function submitClientClaim(
  orgId: string,
  clientId: string,
  input: SubmitClaimInput,
  source = "client portal",
): Promise<Claim> {
  // Preserve client-auth.ts's original raw-value semantics exactly (no trimming, `x || null`).
  const { policyId, claimType, deceasedName, deceasedRelationship, dateOfDeath, causeOfDeath } = input as Record<string, any>;
  if (!policyId || !claimType) {
    throw new CustomerInputError("Policy and claim type are required");
  }
  const policy = await storage.getPolicy(policyId, orgId);
  if (!policy || policy.clientId !== clientId) {
    throw new CustomerForbiddenError();
  }

  const parsedBase = {
    organizationId: orgId,
    policyId,
    clientId,
    claimType,
    status: "submitted",
    deceasedName: deceasedName || null,
    deceasedRelationship: deceasedRelationship || null,
    dateOfDeath: dateOfDeath || null,
    causeOfDeath: causeOfDeath || null,
  };

  // Link the claimed covered member by name when it matches exactly one member who doesn't
  // already have a conflicting claim — so the verdict can be recorded against them later.
  // Anything ambiguous stays unlinked for staff to pick on the claim. Looked up before the
  // transaction, not inside it: a failed query inside a Postgres transaction aborts it, so
  // swallowing the error there would have failed the whole claim.
  let policyMemberId: string | null = null;
  try {
    const { findPolicyMemberByName, findConflictingMemberClaim } = await import("./claim-workflow");
    const tdb = await getDbForOrg(orgId);
    const match = await findPolicyMemberByName(tdb, policyId, deceasedName);
    if (match && !(await findConflictingMemberClaim(tdb, orgId, match, claimType))) policyMemberId = match;
  } catch {
    policyMemberId = null;
  }

  let created: Claim;
  try {
    created = await withOrgTransaction(orgId, async (txDb) => {
      const seqResult = await txDb.execute(sql`
        INSERT INTO org_policy_sequences (organization_id, claim_next) VALUES (${orgId}, 1)
        ON CONFLICT (organization_id) DO UPDATE SET claim_next = org_policy_sequences.claim_next + 1
        RETURNING claim_next
      `);
      const nextVal = (seqResult as unknown as { rows?: { claim_next: number }[] }).rows?.[0]?.claim_next ?? 1;
      const claimNumber = `CLM-${String(nextVal).padStart(6, "0")}`;
      const parsed = insertClaimSchema.parse({ ...parsedBase, claimNumber, ...(policyMemberId ? { policyMemberId } : {}) });
      const [row] = await txDb.insert(claims).values(parsed).returning();
      await txDb.insert(claimStatusHistory).values({
        claimId: row.id,
        fromStatus: null,
        toStatus: "submitted",
        reason: `Submitted via ${source}`,
        changedBy: undefined,
      });
      if (policyMemberId) {
        await txDb.update(policyMembers).set({
          claimStatus: "claim_pending", claimVerdictNote: `Claim ${claimNumber} submitted via ${source}`, claimVerdictAt: null,
        }).where(eq(policyMembers.id, policyMemberId));
      }
      return row;
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CustomerInputError(err.errors?.[0]?.message || "Validation failed");
    }
    throw err;
  }
  // Best effort, after commit: tell the client it was received (SMS per the tenant's
  // claim_status_change template) and tell staff there's a claim to deal with — a client-submitted
  // claim has no staff "initiator", so it never gets an Approvals-queue entry of its own.
  const submitted = created;
  // Audit trail — the actor is the client, not a staff user, so there's no actor_id; the email
  // column says who and through which channel.
  try {
    await storage.createAuditLog({
      organizationId: orgId,
      actorId: null,
      actorEmail: `client:${clientId} (via ${source})`,
      action: "CREATE_CLAIM",
      entityType: "Claim",
      entityId: submitted.id,
      before: null,
      after: submitted as any,
    } as any);
  } catch {
    /* best effort — the claim itself is already committed */
  }
  import("./claim-workflow")
    .then((m) => m.notifyClientOfClaim(orgId, submitted, "submitted"))
    .catch(() => {});
  import("./user-notifications")
    .then((m) => m.notifyUsersWithPermission(orgId, "write:claim", {
      type: "CLAIM_SUBMITTED",
      title: "New claim from a client",
      body: `Claim ${submitted.claimNumber} was submitted via ${source} and needs to be reviewed on the Claims page.`,
      metadata: { claimId: submitted.id, claimNumber: submitted.claimNumber },
    }))
    .catch(() => {});
  return created;
}

export interface BeneficiaryInput {
  dependentId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  relationship?: unknown;
  nationalId?: unknown;
  phone?: unknown;
}

/**
 * Set (or reassign) a policy's beneficiary. Extracted from client-auth.ts's
 * `PUT /api/client-auth/policies/:id/beneficiary`. The caller must pass a policy it has already
 * confirmed belongs to `clientId`.
 */
export async function setPolicyBeneficiary(
  orgId: string,
  clientId: string,
  policy: Policy,
  input: BeneficiaryInput,
): Promise<{ message: string }> {
  const dependentId = typeof input.dependentId === "string" && input.dependentId ? input.dependentId : null;

  if (dependentId) {
    const deps = await storage.getDependentsByClient(clientId, orgId);
    const dep = deps.find((d) => d.id === dependentId);
    if (!dep) throw new CustomerInputError("Dependent not found");
    await storage.updatePolicy(
      policy.id,
      {
        beneficiaryFirstName: dep.firstName,
        beneficiaryLastName: dep.lastName,
        beneficiaryRelationship: dep.relationship,
        beneficiaryNationalId: dep.nationalId || null,
        beneficiaryPhone: null,
        beneficiaryDependentId: dep.id,
      },
      orgId,
    );
    return { message: "Dependent appointed as beneficiary" };
  }

  const firstName = typeof input.firstName === "string" ? input.firstName : "";
  const lastName = typeof input.lastName === "string" ? input.lastName : "";
  if (!firstName || !lastName) {
    throw new CustomerInputError("Beneficiary first name and last name are required");
  }
  await storage.updatePolicy(
    policy.id,
    {
      beneficiaryFirstName: String(firstName).trim(),
      beneficiaryLastName: String(lastName).trim(),
      beneficiaryRelationship: input.relationship ? String(input.relationship).trim() : null,
      beneficiaryNationalId: input.nationalId ? String(input.nationalId).trim() : null,
      beneficiaryPhone: input.phone ? String(input.phone).trim() : null,
      beneficiaryDependentId: null,
    },
    orgId,
  );
  return { message: "Beneficiary set" };
}
