/**
 * The complete POL263 Customer Service API — a tenant-isolated, verification-token-authenticated
 * surface that external customer-service channels (SMSALA WhatsApp bot "Pol263 Customer Service")
 * consume. Generic and channel-agnostic: there is no SMSALA-specific logic here.
 *
 * Auth model (see server/customer-service-integration.ts):
 *   • POST /verify                — shared secret only  → issues a 15-min verification token
 *   • every other endpoint        — shared secret (Authorization: Bearer) + verification token
 *                                   (X-Verification-Token). requireVerifiedCustomer sets
 *                                   req.customerService = { orgId, clientId, verifiedPolicyId }.
 *
 * Tenant identity comes ONLY from the decrypted shared secret / verification token — never from
 * the body, query, params, or an arbitrary header. Every :policyId route calls
 * assertPolicyBelongsToVerifiedClient first (client-scoped: the customer may reach any policy
 * that is theirs, addressed by policy number or id).
 *
 * All reads reuse existing storage methods; all writes reuse existing services
 * (server/customer-self-service.ts, server/payment-service.ts). No business logic is duplicated.
 *
 * CSRF: /api/customer-service/* is exempt (own auth) — see server/index.ts.
 * Rate limiting: /verify keeps the strict 20/min bucket; the rest get 60/min — see server/index.ts.
 * Audit: every operation → platformAuditLog + structuredLog, never logging policy numbers,
 * national IDs, phone numbers, secrets, tokens, OTPs, payment payloads, or storage keys.
 */
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { platformAuditLog } from "./route-helpers";
import { enrichPoliciesWithBalance } from "./policy-balance";
import { streamPolicyDocumentToResponse } from "./policy-document";
import { getReceiptPdfPath } from "./receipt-pdf";
import {
  createPaymentIntent,
  initiatePaynowPayment,
  submitOmariOtp,
  pollPaynowStatus,
} from "./payment-service";
import {
  submitClientClaim,
  setPolicyBeneficiary,
  CustomerInputError,
  CustomerForbiddenError,
} from "./customer-self-service";
import {
  handleVerifyRequest,
  requireVerifiedCustomer,
  assertPolicyBelongsToVerifiedClient,
  refreshVerificationToken,
  authenticateCustomerServiceRequest,
  VERIFICATION_TOKEN_TTL_SECONDS,
  CS_ERROR,
} from "./customer-service-integration";
import { insertClientFeedbackSchema } from "@shared/schema";

// ─── helpers ─────────────────────────────────────────────────────────────────

type CSContext = { orgId: string; clientId: string; verifiedPolicyId: string };

/** Record every operation to the platform audit trail + structured log. `after` must never
 *  contain PII / secrets / storage keys — pass booleans, counts, and opaque ids only. */
async function audit(req: Request, operation: string, after: Record<string, unknown> = {}): Promise<void> {
  const ctx = req.customerService;
  structuredLog("info", operation, { requestId: (req as any).requestId, ip: req.ip, orgId: ctx?.orgId, ...after });
  await platformAuditLog(req, operation, "CustomerServiceIntegration", ctx?.orgId, null, after);
}

/** Wrap an async handler: map known errors to canonical JSON, swallow everything else to a
 *  generic 500 (no SQL text, no stack, no internals). */
function h(operation: string, fn: (req: Request, res: Response, ctx: CSContext) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const ctx = req.customerService as CSContext;
    try {
      await fn(req, res, ctx);
    } catch (err) {
      if (err instanceof CustomerInputError) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      if (err instanceof CustomerForbiddenError) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      structuredLog("error", `${operation}_ERROR`, {
        requestId: (req as any).requestId,
        orgId: ctx?.orgId,
        error: (err as Error).message,
      });
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
  };
}

const num = (v: unknown): string | null => (v == null ? null : String(v));

// ─── field mappers (customer-safe allow-lists) ───────────────────────────────

/** `p` is an enriched policy from enrichPoliciesWithBalance. */
function toCustomerPolicy(p: any) {
  return {
    policy_number: p.policyNumber,
    status: p.status,
    currency: p.currency,
    premium_amount: num(p.premiumAmount),
    payment_schedule: p.paymentSchedule,
    inception_date: p.inceptionDate ?? null,
    effective_date: p.effectiveDate ?? null,
    current_cycle_start: p.currentCycleStart ?? null,
    current_cycle_end: p.currentCycleEnd ?? null,
    grace_end_date: p.graceEndDate ?? null,
    next_due_date: p.currentCycleEnd ?? p.graceEndDate ?? null,
    total_paid: p.totalPaid,
    total_due: p.totalDue,
    balance: p.balance,
    outstanding: p.outstanding,
    wallet_balance: p.walletBalance,
    periods_elapsed: p.periodsElapsed,
  };
}

function toCustomerMember(m: any) {
  return { role: m.role, member_number: m.memberNumber ?? null, is_active: !!m.isActive };
}

function toCustomerPayment(t: any) {
  return {
    amount: num(t.amount),
    currency: t.currency,
    method: t.paymentMethod ?? null,
    status: t.status,
    reference: t.reference ?? null,
    period_from: t.periodFrom ?? null,
    period_to: t.periodTo ?? null,
    received_at: t.receivedAt ?? null,
  };
}

function toCustomerReceipt(r: any) {
  return {
    receipt_number: r.receiptNumber,
    amount: num(r.amount),
    currency: r.currency,
    payment_channel: r.paymentChannel ?? null,
    period_from: r.periodFrom ?? null,
    period_to: r.periodTo ?? null,
    issued_at: r.issuedAt ?? null,
    status: r.status,
  };
}

function toCustomerCreditNote(n: any) {
  return {
    credit_note_number: n.creditNoteNumber,
    amount: num(n.amount),
    currency: n.currency,
    reason: n.reason ?? null,
    created_at: n.createdAt ?? null,
  };
}

function toCustomerClaim(c: any) {
  return {
    claim_number: c.claimNumber,
    claim_type: c.claimType,
    status: c.status,
    deceased_name: c.deceasedName ?? null,
    deceased_relationship: c.deceasedRelationship ?? null,
    date_of_death: c.dateOfDeath ?? null,
    currency: c.currency ?? null,
    created_at: c.createdAt ?? null,
  };
}

function toCustomerDocument(d: any) {
  return {
    document_type: d.documentType,
    label: d.label ?? null,
    file_name: d.fileName,
    mime_type: d.mimeType ?? null,
    uploaded_at: d.uploadedAt ?? d.createdAt ?? null,
  };
}

function toCustomerNotification(n: any) {
  return {
    channel: n.channel,
    subject: n.subject ?? null,
    body: n.body ?? null,
    status: n.status,
    read_at: n.readAt ?? null,
    sent_at: n.sentAt ?? null,
    created_at: n.createdAt ?? null,
  };
}

function toCustomerDependent(d: any) {
  return {
    id: d.id, // required so DELETE /dependents/:id is addressable
    first_name: d.firstName,
    last_name: d.lastName,
    relationship: d.relationship,
    date_of_birth: d.dateOfBirth ?? null,
    gender: d.gender ?? null,
  };
}

// ─── registration ───────────────────────────────────────────────────────────

export function registerCustomerServiceRoutes(app: Express): void {
  // ---- verification (shared secret only) --------------------------------------
  app.post("/api/customer-service/verify", (req, res) => {
    void handleVerifyRequest(req, res);
  });

  // ---- token refresh --------------------------------------------------------
  app.post("/api/customer-service/token/refresh", async (req: Request, res: Response) => {
    const auth = await authenticateCustomerServiceRequest(req);
    if (!auth) {
      res.status(401).json(CS_ERROR.unauthorized);
      return;
    }
    const presented = req.header("X-Verification-Token") || "";
    const refreshed = refreshVerificationToken(presented, auth.orgId);
    if (!refreshed) {
      structuredLog("warn", "CUSTOMER_SERVICE_TOKEN_REFRESH_FAILED", { requestId: (req as any).requestId, orgId: auth.orgId });
      res.status(401).json(CS_ERROR.unauthorized);
      return;
    }
    await platformAuditLog(req, "CUSTOMER_SERVICE_TOKEN_REFRESH", "CustomerServiceIntegration", auth.orgId, null, { refreshed: true });
    res.json({ verification_token: refreshed.token, expires_in: refreshed.expiresIn });
  });

  // Everything below requires shared secret + verification token (requireVerifiedCustomer
  // handles its own response on failure and never throws).
  const guard = requireVerifiedCustomer;

  // ---- session ------------------------------------------------------------
  app.get(
    "/api/customer-service/session",
    guard,
    h("CUSTOMER_SERVICE_SESSION", async (req, res, ctx) => {
      const client = await storage.getClient(ctx.clientId, ctx.orgId);
      const policy = await storage.getPolicy(ctx.verifiedPolicyId, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_SESSION");
      res.json({
        customer: { name: client ? [client.title, client.firstName, client.lastName].filter(Boolean).join(" ").trim() : null },
        verified_policy_number: policy?.policyNumber ?? null,
        expires_in: VERIFICATION_TOKEN_TTL_SECONDS,
      });
    }),
  );

  // ---- policies ---------------------------------------------------------------
  app.get(
    "/api/customer-service/policies",
    guard,
    h("CUSTOMER_SERVICE_LIST_POLICIES", async (req, res, ctx) => {
      const raw = await storage.getPoliciesByClient(ctx.clientId, ctx.orgId);
      const enriched = await enrichPoliciesWithBalance(raw, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_LIST_POLICIES", { count: enriched.length });
      res.json({ policies: enriched.map(toCustomerPolicy) });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId",
    guard,
    h("CUSTOMER_SERVICE_GET_POLICY", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const [enriched] = await enrichPoliciesWithBalance([policy], ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_POLICY");
      res.json({ policy: toCustomerPolicy(enriched) });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/members",
    guard,
    h("CUSTOMER_SERVICE_GET_MEMBERS", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const members = await storage.getPolicyMembers(policy.id, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_MEMBERS", { count: members.length });
      res.json({ members: members.map(toCustomerMember) });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/beneficiary",
    guard,
    h("CUSTOMER_SERVICE_GET_BENEFICIARY", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_BENEFICIARY");
      if (!policy.beneficiaryFirstName) {
        res.json({ beneficiary: null });
        return;
      }
      res.json({
        beneficiary: {
          first_name: policy.beneficiaryFirstName,
          last_name: policy.beneficiaryLastName,
          relationship: policy.beneficiaryRelationship ?? null,
          national_id: policy.beneficiaryNationalId ?? null,
          phone: policy.beneficiaryPhone ?? null,
        },
      });
    }),
  );

  app.put(
    "/api/customer-service/policies/:policyId/beneficiary",
    guard,
    h("CUSTOMER_SERVICE_UPDATE_BENEFICIARY", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const result = await setPolicyBeneficiary(ctx.orgId, ctx.clientId, policy, req.body || {});
      await audit(req, "CUSTOMER_SERVICE_UPDATE_BENEFICIARY", { via_dependent: !!(req.body && req.body.dependentId) });
      res.json(result);
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/payments",
    guard,
    h("CUSTOMER_SERVICE_GET_PAYMENTS", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const payments = await storage.getPaymentsByPolicy(policy.id, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_PAYMENTS", { count: payments.length });
      res.json({ payments: payments.map(toCustomerPayment) });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/agent",
    guard,
    h("CUSTOMER_SERVICE_GET_AGENT", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_AGENT");
      if (!policy.agentId) {
        res.json({ agent: null });
        return;
      }
      const agent = await storage.getUser(policy.agentId, ctx.orgId);
      if (!agent) {
        res.json({ agent: null });
        return;
      }
      res.json({ agent: { name: agent.displayName ?? null, phone: agent.whatsapp || agent.phone || null } });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/document",
    guard,
    h("CUSTOMER_SERVICE_GET_DOCUMENT", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_DOCUMENT");
      await streamPolicyDocumentToResponse(policy.id, ctx.orgId, res, { attachment: true });
    }),
  );

  app.get(
    "/api/customer-service/policies/:policyId/funeral",
    guard,
    h("CUSTOMER_SERVICE_GET_FUNERAL", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const fc = await storage.getFuneralCaseByPolicy(policy.id, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_FUNERAL", { exists: !!fc });
      if (!fc) {
        res.json({ funeral: null });
        return;
      }
      res.json({
        funeral: {
          funeral_date: fc.funeralDate ?? null,
          funeral_location: fc.funeralLocation ?? null,
          memorial_service_start: fc.memorialServiceStart ?? null,
        },
      });
    }),
  );

  // ---- payment intents (per policy) ------------------------------------------
  app.post(
    "/api/customer-service/policies/:policyId/payment-intents",
    guard,
    h("CUSTOMER_SERVICE_PAYMENT_INTENT", async (req, res, ctx) => {
      const policy = await assertPolicyBelongsToVerifiedClient(req.params.policyId as string, ctx);
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const body = req.body || {};
      const amount = body.amount;
      const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : body.idempotencyKey;
      const amountNum = parseFloat(String(amount));
      if (!idempotencyKey || !Number.isFinite(amountNum) || amountNum <= 0) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      const result = await createPaymentIntent({
        organizationId: ctx.orgId,
        clientId: ctx.clientId,
        policyId: policy.id,
        amount: String(amount),
        currency: policy.currency || "USD",
        purpose: typeof body.purpose === "string" ? body.purpose : "premium",
        idempotencyKey: String(idempotencyKey),
      });
      if (result.error) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_PAYMENT_INTENT", { created: result.created, intentId: result.intent.id });
      res.json({
        payment_intent: {
          id: result.intent.id,
          status: result.intent.status,
          amount: num(result.intent.amount),
          currency: result.intent.currency,
          purpose: result.intent.purpose,
        },
        created: result.created,
      });
    }),
  );

  /** Load a payment intent that belongs to the verified client, or null. */
  async function ownIntent(ctx: CSContext, intentId: string) {
    if (!intentId || typeof intentId !== "string") return null;
    const intent = await storage.getPaymentIntentById(intentId, ctx.orgId);
    if (!intent || intent.organizationId !== ctx.orgId || intent.clientId !== ctx.clientId) return null;
    return intent;
  }

  app.post(
    "/api/customer-service/payment-intents/:id/initiate",
    guard,
    h("CUSTOMER_SERVICE_PAYMENT_INITIATE", async (req, res, ctx) => {
      const intent = await ownIntent(ctx, req.params.id as string);
      if (!intent) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const body = req.body || {};
      const result = await initiatePaynowPayment({
        intentId: intent.id,
        organizationId: ctx.orgId,
        method: typeof body.method === "string" ? body.method : "visa_mastercard",
        payerPhone: typeof body.payer_phone === "string" ? body.payer_phone : body.payerPhone,
        payerEmail: typeof body.payer_email === "string" ? body.payer_email : body.payerEmail,
        actorType: "client",
        actorId: null,
      });
      if (!result.ok) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_PAYMENT_INITIATE", { intentId: intent.id, needsOtp: !!result.omariOtpUrl });
      res.json({
        redirect_url: result.redirectUrl ?? null,
        poll_url: result.pollUrl ?? null,
        innbucks_code: result.innbucksCode ?? null,
        innbucks_expiry: result.innbucksExpiry ?? null,
        needs_otp: !!result.omariOtpUrl,
      });
    }),
  );

  app.post(
    "/api/customer-service/payment-intents/:id/otp",
    guard,
    h("CUSTOMER_SERVICE_PAYMENT_OTP", async (req, res, ctx) => {
      const intent = await ownIntent(ctx, req.params.id as string);
      if (!intent) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const otp = req.body && typeof req.body.otp === "string" ? req.body.otp.trim() : "";
      if (otp.length < 4) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      const result = await submitOmariOtp(intent.id, ctx.orgId, otp, "client", null);
      if (!result.ok) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_PAYMENT_OTP", { intentId: intent.id, paid: !!result.paid });
      res.json({ paid: !!result.paid });
    }),
  );

  app.get(
    "/api/customer-service/payment-intents/:id/status",
    guard,
    h("CUSTOMER_SERVICE_PAYMENT_STATUS", async (req, res, ctx) => {
      const intent = await ownIntent(ctx, req.params.id as string);
      if (!intent) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const result = await pollPaynowStatus(intent.id, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_PAYMENT_STATUS", { intentId: intent.id, status: result.status });
      res.json({ status: result.status, paid: !!result.paid });
    }),
  );

  // ---- receipts -------------------------------------------------------------
  app.get(
    "/api/customer-service/receipts",
    guard,
    h("CUSTOMER_SERVICE_GET_RECEIPTS", async (req, res, ctx) => {
      const receipts = await storage.getPaymentReceiptsByClient(ctx.clientId, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_RECEIPTS", { count: receipts.length });
      res.json({ receipts: receipts.map(toCustomerReceipt) });
    }),
  );

  /** Find a receipt by id or receipt number among the verified client's own receipts. */
  async function ownReceipt(ctx: CSContext, ref: string) {
    if (!ref || typeof ref !== "string") return null;
    const receipts = await storage.getPaymentReceiptsByClient(ctx.clientId, ctx.orgId);
    const r = ref.trim();
    const rUpper = r.toUpperCase();
    return receipts.find((x) => x.id === r || (x.receiptNumber && x.receiptNumber.toUpperCase() === rUpper)) ?? null;
  }

  app.get(
    "/api/customer-service/receipts/:id",
    guard,
    h("CUSTOMER_SERVICE_GET_RECEIPT", async (req, res, ctx) => {
      const receipt = await ownReceipt(ctx, req.params.id as string);
      if (!receipt) {
        res.status(404).json(CS_ERROR.not_found);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_RECEIPT");
      res.json({ receipt: toCustomerReceipt(receipt) });
    }),
  );

  app.get(
    "/api/customer-service/receipts/:id/document",
    guard,
    h("CUSTOMER_SERVICE_GET_RECEIPT_DOCUMENT", async (req, res, ctx) => {
      const receipt = await ownReceipt(ctx, req.params.id as string);
      if (!receipt) {
        res.status(404).json(CS_ERROR.not_found);
        return;
      }
      const result = await getReceiptPdfPath(receipt.pdfStorageKey);
      if (!result) {
        res.status(404).json(CS_ERROR.not_found);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_RECEIPT_DOCUMENT");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${receipt.receiptNumber}.pdf"`);
      if (Buffer.isBuffer(result)) {
        res.send(result);
        return;
      }
      res.download(result, `receipt-${receipt.receiptNumber}.pdf`);
    }),
  );

  // ---- credit -------------------------------------------------------------
  app.get(
    "/api/customer-service/credit-balance",
    guard,
    h("CUSTOMER_SERVICE_GET_CREDIT_BALANCE", async (req, res, ctx) => {
      const policies = await storage.getPoliciesByClient(ctx.clientId, ctx.orgId);
      const balances = [];
      for (const p of policies) {
        const b = await storage.getPolicyCreditBalance(ctx.orgId, p.id);
        balances.push({ policy_number: p.policyNumber, balance: num(b?.balance ?? "0"), currency: b?.currency ?? p.currency ?? "USD" });
      }
      await audit(req, "CUSTOMER_SERVICE_GET_CREDIT_BALANCE", { count: balances.length });
      res.json({ credit_balances: balances });
    }),
  );

  app.get(
    "/api/customer-service/credit-notes",
    guard,
    h("CUSTOMER_SERVICE_GET_CREDIT_NOTES", async (req, res, ctx) => {
      const notes = await storage.getCreditNotesByClient(ctx.clientId, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_CREDIT_NOTES", { count: notes.length });
      res.json({ credit_notes: notes.map(toCustomerCreditNote) });
    }),
  );

  // ---- claims -------------------------------------------------------------
  app.get(
    "/api/customer-service/claims",
    guard,
    h("CUSTOMER_SERVICE_GET_CLAIMS", async (req, res, ctx) => {
      const claims = await storage.getClaimsByClient(ctx.clientId, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_CLAIMS", { count: claims.length });
      res.json({ claims: claims.map(toCustomerClaim) });
    }),
  );

  app.get(
    "/api/customer-service/claims/:id",
    guard,
    h("CUSTOMER_SERVICE_GET_CLAIM", async (req, res, ctx) => {
      const claims = await storage.getClaimsByClient(ctx.clientId, ctx.orgId);
      const ref = String(req.params.id || "").trim();
      const refUpper = ref.toUpperCase();
      const claim = claims.find((c) => c.id === ref || (c.claimNumber && c.claimNumber.toUpperCase() === refUpper));
      if (!claim) {
        res.status(404).json(CS_ERROR.not_found);
        return;
      }
      await audit(req, "CUSTOMER_SERVICE_GET_CLAIM");
      res.json({ claim: toCustomerClaim(claim) });
    }),
  );

  app.post(
    "/api/customer-service/claims",
    guard,
    h("CUSTOMER_SERVICE_CREATE_CLAIM", async (req, res, ctx) => {
      const body = req.body || {};
      // Accept snake_case (external) and camelCase; policy addressed by number or id.
      const policyRef = body.policy_number ?? body.policyId ?? body.policy_id;
      const policy = policyRef ? await assertPolicyBelongsToVerifiedClient(String(policyRef), ctx) : null;
      if (!policy) {
        res.status(403).json(CS_ERROR.forbidden);
        return;
      }
      const claim = await submitClientClaim(
        ctx.orgId,
        ctx.clientId,
        {
          policyId: policy.id,
          claimType: body.claim_type ?? body.claimType,
          deceasedName: body.deceased_name ?? body.deceasedName,
          deceasedRelationship: body.deceased_relationship ?? body.deceasedRelationship,
          dateOfDeath: body.date_of_death ?? body.dateOfDeath,
          causeOfDeath: body.cause_of_death ?? body.causeOfDeath,
        },
        "customer service",
      );
      await audit(req, "CUSTOMER_SERVICE_CREATE_CLAIM", { claimId: claim.id });
      res.status(201).json({ claim: toCustomerClaim(claim) });
    }),
  );

  // ---- documents (metadata) ------------------------------------------------
  app.get(
    "/api/customer-service/documents",
    guard,
    h("CUSTOMER_SERVICE_LIST_DOCUMENTS", async (req, res, ctx) => {
      const docs = await storage.getClientDocuments(ctx.clientId, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_LIST_DOCUMENTS", { count: docs.length });
      res.json({ documents: docs.map(toCustomerDocument) });
    }),
  );

  // ---- notifications -----------------------------------------------------
  app.get(
    "/api/customer-service/notifications",
    guard,
    h("CUSTOMER_SERVICE_GET_NOTIFICATIONS", async (req, res, ctx) => {
      const requested = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 50) : 20;
      const logs = await storage.getClientNotifications(ctx.clientId, ctx.orgId, limit);
      await audit(req, "CUSTOMER_SERVICE_GET_NOTIFICATIONS", { count: logs.length });
      res.json({ notifications: logs.map(toCustomerNotification) });
    }),
  );

  // ---- tenant contact --------------------------------------------------
  app.get(
    "/api/customer-service/tenant",
    guard,
    h("CUSTOMER_SERVICE_GET_TENANT", async (req, res, ctx) => {
      const org = await storage.getOrganization(ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_GET_TENANT");
      res.json({
        organization: {
          name: org?.name ?? null,
          phone: org?.phone ?? null,
          email: org?.email ?? null,
          address: org?.address ?? null,
        },
      });
    }),
  );

  // ---- feedback / complaint --------------------------------------------
  app.post(
    "/api/customer-service/feedback",
    guard,
    h("CUSTOMER_SERVICE_CREATE_FEEDBACK", async (req, res, ctx) => {
      const body = req.body || {};
      const rawType = String(body.type ?? "feedback").toLowerCase();
      const type = rawType === "complaint" ? "complaint" : rawType === "feedback" || rawType === "service issue" || rawType === "service_issue" ? "feedback" : null;
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!type || !subject || !message) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      const parsed = insertClientFeedbackSchema.parse({
        organizationId: ctx.orgId,
        clientId: ctx.clientId,
        type,
        subject: subject.slice(0, 500),
        message: message.slice(0, 5000),
        status: "open",
      });
      const created = await storage.createFeedback(parsed);
      await audit(req, "CUSTOMER_SERVICE_CREATE_FEEDBACK", { feedbackId: created.id, type });
      res.status(201).json({ feedback: { id: created.id, type: created.type, subject: created.subject, status: created.status, created_at: created.createdAt } });
    }),
  );

  // ---- dependents ------------------------------------------------------
  app.post(
    "/api/customer-service/dependents",
    guard,
    h("CUSTOMER_SERVICE_CREATE_DEPENDENT", async (req, res, ctx) => {
      const body = req.body || {};
      const firstName = typeof body.first_name === "string" ? body.first_name.trim() : typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.last_name === "string" ? body.last_name.trim() : typeof body.lastName === "string" ? body.lastName.trim() : "";
      const relationship = typeof body.relationship === "string" ? body.relationship.trim() : "";
      if (!firstName || !lastName || !relationship) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      const dob = body.date_of_birth ?? body.dateOfBirth;
      const nationalId = body.national_id ?? body.nationalId;
      const created = await storage.createDependent({
        organizationId: ctx.orgId,
        clientId: ctx.clientId,
        firstName,
        lastName,
        relationship,
        dateOfBirth: dob ? String(dob) : null,
        nationalId: nationalId ? String(nationalId).trim() : null,
        gender: typeof body.gender === "string" ? body.gender : null,
      });
      await audit(req, "CUSTOMER_SERVICE_CREATE_DEPENDENT", { dependentId: created.id });
      res.status(201).json({ dependent: toCustomerDependent(created) });
    }),
  );

  app.delete(
    "/api/customer-service/dependents/:id",
    guard,
    h("CUSTOMER_SERVICE_DELETE_DEPENDENT", async (req, res, ctx) => {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json(CS_ERROR.invalid_request);
        return;
      }
      const deps = await storage.getDependentsByClient(ctx.clientId, ctx.orgId);
      const dep = deps.find((d) => d.id === id);
      if (!dep) {
        res.status(404).json(CS_ERROR.not_found);
        return;
      }
      await storage.deleteDependent(dep.id, ctx.orgId);
      await audit(req, "CUSTOMER_SERVICE_DELETE_DEPENDENT", { dependentId: dep.id });
      res.json({ deleted: true });
    }),
  );
}
