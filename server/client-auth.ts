import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { z } from "zod";
import argon2 from "argon2";
import { createPaymentIntent, initiatePaynowPayment, pollPaynowStatus } from "./payment-service";
import { getPaynowConfig } from "./paynow-config";
import { streamPolicyDocumentToResponse } from "./policy-document";
import { insertClaimSchema, insertClientFeedbackSchema } from "@shared/schema";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const CONSTANT_DELAY_MS = 200;

async function constantTimeResponse(res: Response, status: number, body: any) {
  await new Promise((resolve) => setTimeout(resolve, CONSTANT_DELAY_MS));
  return res.status(status).json(body);
}

const isLegacySha256Hash = (hash: string | null | undefined) =>
  !!hash && /^[a-f0-9]{64}$/i.test(hash);

async function hashSecret(value: string) {
  return argon2.hash(value, { type: argon2.argon2id });
}

async function verifySecret(input: string, storedHash: string) {
  if (isLegacySha256Hash(storedHash)) {
    const crypto = await import("crypto");
    const legacyHash = crypto.createHash("sha256").update(input).digest("hex");
    return legacyHash === storedHash;
  }
  return argon2.verify(storedHash, input);
}

export function setupClientAuth(app: Express) {
  app.post("/api/client-auth/claim", async (req: Request, res: Response) => {
    const { activationCode, policyNumber } = req.body;
    if (!activationCode || !policyNumber) {
      return constantTimeResponse(res, 400, { message: "Activation code and policy number are required" });
    }

    try {
      const orgs = await storage.getOrganizations();
      if (orgs.length === 0) {
        return constantTimeResponse(res, 400, { message: "System not configured" });
      }

      let client = null;
      let matchedOrgId: string | null = null;
      for (const org of orgs) {
        client = await storage.getClientByActivationCode(activationCode, org.id);
        if (client) { matchedOrgId = org.id; break; }
      }
      if (!client || !matchedOrgId) {
        return constantTimeResponse(res, 400, { message: "Invalid activation code or policy number" });
      }

      const policy = await storage.getPolicyByNumber(policyNumber, matchedOrgId);
      if (!policy || policy.clientId !== client.id) {
        return constantTimeResponse(res, 400, { message: "Invalid activation code or policy number" });
      }

      if (client.isEnrolled) {
        return constantTimeResponse(res, 400, { message: "This policy has already been claimed" });
      }

      const questions = await storage.getOrCreateDefaultSecurityQuestions(matchedOrgId);

      return constantTimeResponse(res, 200, {
        clientId: client.id,
        firstName: client.firstName,
        securityQuestions: questions,
      });
    } catch (err) {
      structuredLog("error", "Client claim error", { error: (err as Error).message });
      return constantTimeResponse(res, 500, { message: "Internal server error" });
    }
  });

  app.post("/api/client-auth/enroll", async (req: Request, res: Response) => {
    const { clientId, password, securityQuestionId, securityAnswer, referralCode } = req.body;
    if (!clientId || !password || !securityQuestionId || !securityAnswer) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof securityQuestionId !== "string" || !uuidRegex.test(securityQuestionId)) {
      return res.status(400).json({ message: "Invalid security question. Please go back and complete the verification step again." });
    }

    try {
      const orgs = await storage.getOrganizations();
      let client = null;
      for (const org of orgs) {
        client = await storage.getClient(clientId, org.id);
        if (client) break;
      }
      if (!client || client.isEnrolled) {
        return res.status(400).json({ message: "Invalid enrollment request" });
      }
      const orgId = client.organizationId;

      const validQuestions = await storage.getSecurityQuestions(orgId);
      const questionIds = new Set(validQuestions.map((q) => q.id));
      if (!questionIds.has(securityQuestionId)) {
        return res.status(400).json({ message: "Invalid security question. Please go back and complete the verification step again." });
      }

      const normalizedAnswer = securityAnswer.trim().toLowerCase();
      const passwordHash = await hashSecret(password);
      const answerHash = await hashSecret(normalizedAnswer);

      await storage.updateClient(clientId, {
        passwordHash,
        securityQuestionId,
        securityAnswerHash: answerHash,
        isEnrolled: true,
        activationCode: null,
      }, orgId);

      if (referralCode) {
        const agent = await storage.getUserByReferralCode(referralCode);
        if (agent) {
          const clientPolicies = await storage.getPoliciesByClient(clientId, orgId);
          for (const policy of clientPolicies) {
            if (!policy.agentId) {
              await storage.updatePolicy(policy.id, { agentId: agent.id }, orgId);
              structuredLog("info", "Agent auto-assigned to policy via referral", {
                policyId: policy.id,
                agentId: agent.id,
                referralCode,
              });
            }
          }
        }
      }

      structuredLog("info", "Client enrolled", { clientId, referralCode: referralCode || null });
      const org = await storage.getOrganization(orgId);
      const { notifyClient } = await import("./notifications");
      await notifyClient(orgId, clientId, "Welcome!", `Welcome to ${org?.name || "our platform"}. Your portal access is now active.`);
      return res.json({ message: "Enrollment successful" });
    } catch (err) {
      structuredLog("error", "Client enrollment error", { error: (err as Error).message });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/client-auth/login", async (req: Request, res: Response) => {
    const { policyNumber, password } = req.body;
    if (!policyNumber || !password) {
      return constantTimeResponse(res, 400, { message: "Policy number and password are required" });
    }

    try {
      const orgs = await storage.getOrganizations();
      if (orgs.length === 0) {
        return constantTimeResponse(res, 400, { message: "Invalid credentials" });
      }

      let policy = null;
      for (const org of orgs) {
        policy = await storage.getPolicyByNumber(policyNumber, org.id);
        if (policy) break;
      }
      if (!policy) {
        return constantTimeResponse(res, 401, { message: "Invalid credentials" });
      }

      const client = await storage.getClient(policy.clientId, policy.organizationId);
      if (!client || !client.isEnrolled || !client.passwordHash) {
        return constantTimeResponse(res, 401, { message: "Invalid credentials" });
      }

      if (client.lockedUntil && new Date(client.lockedUntil) > new Date()) {
        return constantTimeResponse(res, 429, { message: "Account temporarily locked. Try again later." });
      }

      const passwordMatches = await verifySecret(password, client.passwordHash);

      if (!passwordMatches) {
        const attempts = (client.failedLoginAttempts || 0) + 1;
        const updateData: any = { failedLoginAttempts: attempts };
        if (attempts >= LOCKOUT_THRESHOLD) {
          updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        }
        await storage.updateClient(client.id, updateData, client.organizationId);
        return constantTimeResponse(res, 401, { message: "Invalid credentials" });
      }

      await storage.updateClient(client.id, { failedLoginAttempts: 0, lockedUntil: null }, client.organizationId);

      (req.session as any).clientId = client.id;
      (req.session as any).clientOrgId = client.organizationId;

      return constantTimeResponse(res, 200, {
        client: {
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
        },
      });
    } catch (err) {
      structuredLog("error", "Client login error", { error: (err as Error).message });
      return constantTimeResponse(res, 500, { message: "Internal server error" });
    }
  });

  app.get("/api/client-auth/me", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const client = clientOrgId
      ? await storage.getClient(clientId, clientOrgId)
      : await (async () => {
          const orgs = await storage.getOrganizations();
          for (const org of orgs) {
            const c = await storage.getClient(clientId, org.id);
            if (c) return c;
          }
          return undefined;
        })();
    if (!client) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    return res.json({
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
      },
    });
  });

  app.get("/api/client-auth/tenant", async (req: Request, res: Response) => {
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientOrgId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const org = await storage.getOrganization(clientOrgId);
    if (!org) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    return res.json({
      name: org.name,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      address: org.address,
      phone: org.phone,
      email: org.email,
      website: org.website,
      isWhitelabeled: org.isWhitelabeled,
    });
  });

  app.get("/api/client-auth/policies", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    async function enrichWithBalance(policies: any[], orgId: string) {
      const enriched = [];
      for (const p of policies) {
        const payments = await storage.getPaymentsByPolicy(p.id, orgId);
        const totalPaid = payments
          .filter((tx: any) => tx.status === "cleared")
          .reduce((sum: number, tx: any) => sum + parseFloat(tx.amount || "0"), 0);
        const premium = parseFloat(p.premiumAmount || "0");
        const startDate = p.inceptionDate || p.effectiveDate;
        let totalDue = 0;
        let periodsElapsed = 0;
        if (startDate && premium > 0) {
          const start = new Date(startDate);
          const now = new Date();
          if (!isNaN(start.getTime()) && start <= now) {
            const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
            const schedule = p.paymentSchedule || "monthly";
            const periodDays = schedule === "weekly" ? 7 : schedule === "biweekly" ? 14 : schedule === "quarterly" ? 91.31 : schedule === "annually" ? 365.25 : 30.44;
            periodsElapsed = Math.ceil(daysElapsed / periodDays);
            totalDue = periodsElapsed * premium;
          }
        }
        const balance = totalPaid - totalDue;
        enriched.push({
          ...p,
          totalPaid: totalPaid.toFixed(2),
          totalDue: totalDue.toFixed(2),
          balance: balance.toFixed(2),
          periodsElapsed,
        });
      }
      return enriched;
    }

    if (!clientOrgId) {
      const orgs = await storage.getOrganizations();
      for (const org of orgs) {
        const c = await storage.getClient(clientId, org.id);
        if (c) {
          const rawPolicies = await storage.getPoliciesByClient(clientId, c.organizationId);
          return res.json(await enrichWithBalance(rawPolicies, c.organizationId));
        }
      }
      return res.json([]);
    }
    const clientPolicies = await storage.getPoliciesByClient(clientId, clientOrgId);
    return res.json(await enrichWithBalance(clientPolicies, clientOrgId));
  });

  /** Look up another client to pay for their policy. Supports phone, policy number, and national ID lookup. */
  app.get("/api/client-auth/lookup-by-phone", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });

    const searchType = typeof req.query.type === "string" ? req.query.type : "phone";
    const q = typeof req.query.q === "string" ? req.query.q.trim()
      : typeof req.query.phone === "string" ? req.query.phone.trim() : "";
    if (!q) return res.status(400).json({ message: "Search query is required" });

    let client: any = null;
    let matchedPolicies: any[] = [];

    if (searchType === "policy") {
      const policy = await storage.getPolicyByNumber(q, clientOrgId);
      if (policy && policy.clientId) {
        client = await storage.getClient(policy.clientId, clientOrgId);
        matchedPolicies = [policy];
      }
    } else if (searchType === "id") {
      client = await storage.getClientByNationalId(clientOrgId, q);
    } else {
      if (q.length < 9) return res.status(400).json({ message: "Valid phone number is required" });
      client = await storage.getClientByPhone(clientOrgId, q);
    }

    if (!client) {
      return res.status(404).json({ message: "No client found" });
    }

    if (matchedPolicies.length === 0) {
      const allPolicies = await storage.getPoliciesByClient(client.id, clientOrgId);
      matchedPolicies = allPolicies;
    }
    const payables = matchedPolicies.filter((p) => p.policyNumber != null && String(p.policyNumber).trim() !== "");
    (req.session as any).lookedUpClientId = client.id;
    (req.session as any).lookedUpClientIdAt = Date.now();
    return res.json({
      clientId: client.id,
      clientName: [client.title, client.firstName, client.lastName].filter(Boolean).join(" "),
      policies: payables.map((p) => ({
        id: p.id,
        policyNumber: p.policyNumber,
        status: p.status,
        premiumAmount: p.premiumAmount,
        currency: p.currency,
      })),
    });
  });

  app.get("/api/client-auth/policies/:id/payments", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) {
      return res.status(403).json({ message: "Access denied" });
    }
    return res.json(await storage.getPaymentsByPolicy(policy.id, clientOrgId));
  });

  app.get("/api/client-auth/policies/:id/members", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) {
      return res.status(403).json({ message: "Access denied" });
    }
    return res.json(await storage.getPolicyMembers(policy.id, clientOrgId));
  });

  app.get("/api/client-auth/policies/:id/document", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) return res.status(403).json({ message: "Access denied" });
    const attachment =
      req.query.download === "1" ||
      req.query.download === "true" ||
      req.query.attachment === "1" ||
      req.query.attachment === "true";
    await streamPolicyDocumentToResponse(policy.id, clientOrgId, res, { attachment });
  });

  app.get("/api/client-auth/claims", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getClaimsByClient(clientId, clientOrgId);
    return res.json(list);
  });

  app.post("/api/client-auth/claims", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { policyId, claimType, deceasedName, deceasedRelationship, dateOfDeath, causeOfDeath } = req.body;
    if (!policyId || !claimType) return res.status(400).json({ message: "Policy and claim type are required" });
    const policy = await storage.getPolicy(policyId, clientOrgId);
    if (!policy || policy.clientId !== clientId) return res.status(403).json({ message: "Access denied" });
    try {
      const claimNumber = await storage.generateClaimNumber(clientOrgId);
      const parsed = insertClaimSchema.parse({
        organizationId: clientOrgId,
        claimNumber,
        policyId,
        clientId,
        claimType,
        status: "submitted",
        deceasedName: deceasedName || null,
        deceasedRelationship: deceasedRelationship || null,
        dateOfDeath: dateOfDeath || null,
        causeOfDeath: causeOfDeath || null,
      });
      const claim = await storage.createClaim(parsed);
      await storage.createClaimStatusHistory(claim.id, null, "submitted", "Submitted via client portal");
      return res.status(201).json(claim);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors?.[0]?.message || "Validation failed" });
      structuredLog("error", "Client claim submit error", { error: (err as Error).message });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/client-auth/feedback", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getFeedbackByClient(clientId, clientOrgId);
    return res.json(list);
  });

  app.post("/api/client-auth/feedback", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { type, subject, message } = req.body;
    if (!type || !subject || !message) return res.status(400).json({ message: "Type, subject, and message are required" });
    if (type !== "complaint" && type !== "feedback") return res.status(400).json({ message: "Type must be complaint or feedback" });
    try {
      const parsed = insertClientFeedbackSchema.parse({
        organizationId: clientOrgId,
        clientId,
        type,
        subject: String(subject).trim().slice(0, 500),
        message: String(message).trim().slice(0, 5000),
        status: "open",
      });
      const feedback = await storage.createFeedback(parsed);
      return res.status(201).json(feedback);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors?.[0]?.message || "Validation failed" });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/client-auth/reset-password", async (req: Request, res: Response) => {
    const { policyNumber, securityAnswer, newPassword } = req.body;
    if (!policyNumber || !securityAnswer || !newPassword) {
      return constantTimeResponse(res, 400, { message: "All fields are required" });
    }

    try {
      const orgs = await storage.getOrganizations();
      if (orgs.length === 0) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      let policy = null;
      for (const org of orgs) {
        policy = await storage.getPolicyByNumber(policyNumber, org.id);
        if (policy) break;
      }
      if (!policy) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      const client = await storage.getClient(policy.clientId, policy.organizationId);
      if (!client || !client.securityAnswerHash) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      const normalizedAnswer = securityAnswer.trim().toLowerCase();
      const answerOk = await verifySecret(normalizedAnswer, client.securityAnswerHash);

      if (!answerOk) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      const newHash = await hashSecret(newPassword);
      await storage.updateClient(client.id, {
        passwordHash: newHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      }, client.organizationId);

      return constantTimeResponse(res, 200, { message: "Password reset successful" });
    } catch (err) {
      return constantTimeResponse(res, 500, { message: "Internal server error" });
    }
  });

  app.post("/api/client-auth/change-password", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }
    const client = await storage.getClient(clientId, clientOrgId);
    if (!client || !client.passwordHash) {
      return res.status(400).json({ message: "No password set for this account" });
    }
    const valid = await verifySecret(currentPassword, client.passwordHash);
    if (!valid) {
      return constantTimeResponse(res, 400, { message: "Current password is incorrect" });
    }
    const newHash = await hashSecret(newPassword);
    await storage.updateClient(clientId, { passwordHash: newHash }, clientOrgId);
    return res.json({ message: "Password updated" });
  });

  app.get("/api/client-auth/credit-balance", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policies = await storage.getPoliciesByClient(clientId, clientOrgId);
    const balances = await Promise.all(
      policies.map(async (p) => {
        const bal = await storage.getPolicyCreditBalance(clientOrgId, p.id);
        return {
          policyId: p.id,
          policyNumber: p.policyNumber,
          balance: bal?.balance || "0",
          currency: bal?.currency || p.currency || "USD",
          premiumAmount: p.premiumAmount,
          status: p.status,
        };
      })
    );
    return res.json(balances);
  });

  app.post("/api/client-auth/logout", (req: Request, res: Response) => {
    (req.session as any).clientId = null;
    (req.session as any).clientOrgId = null;
    res.json({ message: "Logged out" });
  });

  // ─── Client payment intents (Paynow) ────────────────────────
  app.post("/api/client-auth/payment-intents", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { policyId, amount, purpose, idempotencyKey, payForClientId } = req.body;
    if (!policyId || amount == null || !idempotencyKey) {
      return res.status(400).json({ message: "policyId, amount, and idempotencyKey are required" });
    }
    try {
      const policy = await storage.getPolicy(policyId, clientOrgId);
      if (!policy || policy.organizationId !== clientOrgId) {
        return res.status(403).json({ message: "Access denied" });
      }
      let allowedClientId = clientId;
      if (policy.clientId !== clientId) {
        const lookedUp = (req.session as any)?.lookedUpClientId;
        const lookedUpAt = (req.session as any)?.lookedUpClientIdAt;
        const fiveMin = 5 * 60 * 1000;
        if (lookedUp === policy.clientId && lookedUpAt && Date.now() - lookedUpAt < fiveMin) {
          allowedClientId = policy.clientId;
        } else {
          return res.status(403).json({ message: "Access denied. Look up the client by phone first to pay for their policy." });
        }
      }
      const result = await createPaymentIntent({
        organizationId: clientOrgId,
        clientId: allowedClientId,
        policyId,
        amount: String(amount),
        currency: policy?.currency || "USD",
        purpose: purpose || "premium",
        idempotencyKey,
      });
      if (result.error) return res.status(400).json({ message: result.error });
      return res.json({ intent: result.intent, created: result.created });
    } catch (err) {
      structuredLog("error", "Client payment intent create failed", {
        error: (err as Error).message,
        stack: (err as Error).stack,
        clientId,
        policyId,
      });
      return res.status(500).json({ message: "Payment setup failed. Please try again or contact support." });
    }
  });

  app.post("/api/client-auth/payment-intents/:id/initiate", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const intentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      const intent = await storage.getPaymentIntentById(intentId, clientOrgId);
      if (!intent || intent.clientId !== clientId) return res.status(404).json({ message: "Not found" });
      const { method, payerPhone, payerEmail } = req.body;
      const result = await initiatePaynowPayment({
        intentId: intent.id,
        organizationId: clientOrgId,
        method: method || "visa_mastercard",
        payerPhone,
        payerEmail,
        actorType: "client",
        actorId: clientId,
      });
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json({
        redirectUrl: result.redirectUrl,
        pollUrl: result.pollUrl,
        innbucksCode: result.innbucksCode,
        innbucksExpiry: result.innbucksExpiry,
        omariOtpReference: result.omariOtpReference,
        needsOtp: !!result.omariOtpUrl,
      });
    } catch (err) {
      structuredLog("error", "Client PayNow initiate failed", {
        error: (err as Error).message,
        stack: (err as Error).stack,
        clientId,
        intentId,
      });
      return res.status(500).json({ message: "Could not start payment. Please try again or contact support." });
    }
  });

  app.post("/api/client-auth/payment-intents/:id/otp", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const intentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      const intent = await storage.getPaymentIntentById(intentId, clientOrgId);
      if (!intent || intent.clientId !== clientId) return res.status(404).json({ message: "Not found" });
      const { otp } = req.body;
      if (!otp || typeof otp !== "string" || otp.trim().length < 4) {
        return res.status(400).json({ message: "Please enter a valid OTP" });
      }
      const { submitOmariOtp } = await import("./payment-service");
      const result = await submitOmariOtp(intentId, clientOrgId, otp.trim(), "client", clientId);
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json({ paid: result.paid });
    } catch (err) {
      structuredLog("error", "Client O'Mari OTP submit failed", {
        error: (err as Error).message,
        clientId,
        intentId,
      });
      return res.status(500).json({ message: "Could not verify OTP. Please try again." });
    }
  });

  app.get("/api/client-auth/payment-intents/:id/status", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const intentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      const intent = await storage.getPaymentIntentById(intentId, clientOrgId);
      if (!intent || intent.clientId !== clientId) return res.status(404).json({ message: "Not found" });
      const result = await pollPaynowStatus(intent.id, clientOrgId);
      return res.json({ status: result.status, paid: result.paid, error: result.error });
    } catch (err) {
      structuredLog("error", "Client payment status poll failed", {
        error: (err as Error).message,
        clientId,
        intentId,
      });
      return res.status(500).json({ status: "unknown", error: "Could not check status." });
    }
  });

  app.get("/api/client-auth/payment-intents", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const intents = await storage.getPaymentIntentsByClient(clientId, clientOrgId);
    return res.json(intents);
  });

  app.get("/api/client-auth/receipts", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const receipts = await storage.getPaymentReceiptsByClient(clientId, clientOrgId);
    return res.json(receipts);
  });

  app.get("/api/client-auth/receipts/:id/download", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const receipt = await storage.getPaymentReceiptById(receiptId, clientOrgId);
    if (!receipt || receipt.clientId !== clientId) return res.status(404).json({ message: "Not found" });
    const { getReceiptPdfPath } = await import("./receipt-pdf");
    const result = await getReceiptPdfPath(receipt.pdfStorageKey);
    if (!result) return res.status(404).json({ message: "Receipt PDF not available" });
    if (Buffer.isBuffer(result)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${receipt.receiptNumber}.pdf"`);
      return res.send(result);
    }
    return res.download(result, `receipt-${receipt.receiptNumber}.pdf`);
  });

  app.get("/api/client-auth/paynow-config", (_req: Request, res: Response) => {
    const config = getPaynowConfig();
    return res.json({
      enabled: config.enabled,
      mode: config.mode,
      returnUrl: config.returnUrl,
    });
  });

  app.get("/api/client-auth/notifications", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const logs = await storage.getClientNotifications(clientId, clientOrgId, 50);
    return res.json(logs);
  });

  app.get("/api/client-auth/notifications/unread-count", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const count = await storage.getUnreadNotificationCount(clientId, clientOrgId);
    return res.json({ count });
  });

  app.patch("/api/client-auth/notifications/:id/read", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    await storage.markNotificationRead(req.params.id as string, clientId, clientOrgId);
    return res.json({ success: true });
  });

  app.patch("/api/client-auth/notifications/mark-all-read", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    await storage.markAllNotificationsRead(clientId, clientOrgId);
    return res.json({ success: true });
  });

  app.get("/api/client-auth/credit-notes", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const notes = await storage.getCreditNotesByClient(clientId, clientOrgId);
    return res.json(notes);
  });

  app.get("/api/client-auth/settings", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const client = await storage.getClient(clientId, clientOrgId);
    if (!client) return res.status(401).json({ message: "Not authenticated" });
    return res.json({
      notificationTone: (client as any).notificationTone ?? "default",
      pushEnabled: !!(client as any).pushEnabled,
    });
  });

  app.patch("/api/client-auth/settings", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { notificationTone, pushEnabled } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (notificationTone !== undefined && ["default", "silent", "high"].includes(notificationTone)) {
      updates.notificationTone = notificationTone;
    }
    if (pushEnabled !== undefined) updates.pushEnabled = !!pushEnabled;
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    const updated = await storage.updateClient(clientId, updates as any, clientOrgId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json({
      notificationTone: (updated as any).notificationTone ?? "default",
      pushEnabled: !!(updated as any).pushEnabled,
    });
  });

  app.post("/api/client-auth/register-device", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { token, platform } = req.body || {};
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "token is required" });
    }
    const plat = ["ios", "android", "web"].includes(platform) ? platform : "web";
    await storage.addClientDeviceToken(clientOrgId, clientId, token.trim(), plat);
    return res.status(204).send();
  });

  app.delete("/api/client-auth/register-device", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { token } = req.body || {};
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "token is required" });
    }
    await storage.removeClientDeviceToken(clientOrgId, token.trim(), clientId);
    return res.status(204).send();
  });

  // ─── Group executive auto-recognition ────────────────────
  app.get("/api/client-auth/my-groups", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const groups = await storage.getGroupsWhereClientIsExecutive(clientOrgId, clientId);
    return res.json(groups);
  });

  app.get("/api/client-auth/group/:groupId/policies", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const groups = await storage.getGroupsWhereClientIsExecutive(clientOrgId, clientId);
    const group = groups.find(g => g.id === req.params.groupId);
    if (!group) return res.status(403).json({ message: "You are not an executive of this group" });
    const policies = await storage.getPoliciesByGroupId(clientOrgId, req.params.groupId as string);
    const enriched = await Promise.all(
      policies.map(async (p) => {
        const client = p.clientId ? await storage.getClient(p.clientId, clientOrgId) : null;
        return {
          ...p,
          clientFirstName: client?.firstName || null,
          clientLastName: client?.lastName || null,
          clientPhone: client?.phone || null,
        };
      })
    );
    return res.json(enriched);
  });

  app.post("/api/client-auth/group-receipt", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { groupId, policyIds, totalAmount, currency } = req.body;
    if (!groupId || !Array.isArray(policyIds) || policyIds.length === 0 || !totalAmount) {
      return res.status(400).json({ message: "groupId, policyIds, and totalAmount required" });
    }
    const groups = await storage.getGroupsWhereClientIsExecutive(clientOrgId, clientId);
    const group = groups.find(g => g.id === groupId);
    if (!group) return res.status(403).json({ message: "You are not an executive of this group" });
    try {
      const policies = await storage.getPoliciesByGroupId(clientOrgId, groupId);
      const selected = policies.filter(p => policyIds.includes(p.id));
      if (selected.length === 0) return res.status(400).json({ message: "No valid policies selected" });
      const perPolicy = (parseFloat(totalAmount) / selected.length).toFixed(2);
      for (const policy of selected) {
        const tx = await storage.createPaymentTransaction({
          organizationId: clientOrgId,
          policyId: policy.id,
          clientId: policy.clientId,
          amount: perPolicy,
          currency: currency || "USD",
          paymentMethod: "cash",
          status: "cleared",
          reference: `GRP-${group.name.slice(0, 6)}-${Date.now().toString(36)}`,
        });
        await storage.createPlatformReceivable({
          organizationId: clientOrgId,
          sourceTransactionId: tx.id,
          amount: perPolicy,
          currency: currency || "USD",
          isSettled: false,
        });
      }
      return res.status(201).json({ message: "Group receipt processed", count: selected.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Failed to process group receipt" });
    }
  });

  // ─── Dependents (client self-service) ─────────────────────
  app.get("/api/client-auth/dependents", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const deps = await storage.getDependentsByClient(clientId, clientOrgId);
    return res.json(deps);
  });

  app.post("/api/client-auth/dependents", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const { firstName, lastName, relationship, dateOfBirth, nationalId, gender } = req.body || {};
    if (!firstName || !lastName || !relationship) {
      return res.status(400).json({ message: "First name, last name, and relationship are required" });
    }
    try {
      const dep = await storage.createDependent({
        organizationId: clientOrgId,
        clientId,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        relationship: String(relationship).trim(),
        dateOfBirth: dateOfBirth || null,
        nationalId: nationalId ? String(nationalId).trim() : null,
        gender: gender || null,
      });
      return res.status(201).json(dep);
    } catch (err) {
      structuredLog("error", "Client add dependent error", { error: (err as Error).message });
      return res.status(500).json({ message: "Failed to add dependent" });
    }
  });

  app.delete("/api/client-auth/dependents/:id", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ message: "Dependent id required" });
    const deps = await storage.getDependentsByClient(clientId, clientOrgId);
    const dep = deps.find((d) => d.id === id);
    if (!dep) return res.status(404).json({ message: "Dependent not found" });
    await storage.deleteDependent(dep.id, clientOrgId);
    return res.json({ message: "Dependent removed" });
  });

  // ─── Beneficiary per policy (client self-service) ──────────
  app.get("/api/client-auth/policies/:id/beneficiary", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) return res.status(403).json({ message: "Access denied" });
    if (!policy.beneficiaryFirstName) return res.json(null);
    return res.json({
      firstName: policy.beneficiaryFirstName,
      lastName: policy.beneficiaryLastName,
      relationship: policy.beneficiaryRelationship,
      nationalId: policy.beneficiaryNationalId,
      phone: policy.beneficiaryPhone,
      dependentId: policy.beneficiaryDependentId,
    });
  });

  app.put("/api/client-auth/policies/:id/beneficiary", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) return res.status(403).json({ message: "Access denied" });

    const { dependentId, firstName, lastName, relationship, nationalId, phone } = req.body || {};

    if (dependentId) {
      const deps = await storage.getDependentsByClient(clientId, clientOrgId);
      const dep = deps.find((d) => d.id === dependentId);
      if (!dep) return res.status(400).json({ message: "Dependent not found" });
      await storage.updatePolicy(policy.id, {
        beneficiaryFirstName: dep.firstName,
        beneficiaryLastName: dep.lastName,
        beneficiaryRelationship: dep.relationship,
        beneficiaryNationalId: dep.nationalId || null,
        beneficiaryPhone: null,
        beneficiaryDependentId: dep.id,
      }, clientOrgId);
      return res.json({ message: "Dependent appointed as beneficiary" });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({ message: "Beneficiary first name and last name are required" });
    }
    await storage.updatePolicy(policy.id, {
      beneficiaryFirstName: String(firstName).trim(),
      beneficiaryLastName: String(lastName).trim(),
      beneficiaryRelationship: relationship ? String(relationship).trim() : null,
      beneficiaryNationalId: nationalId ? String(nationalId).trim() : null,
      beneficiaryPhone: phone ? String(phone).trim() : null,
      beneficiaryDependentId: null,
    }, clientOrgId);
    return res.json({ message: "Beneficiary set" });
  });

  app.delete("/api/client-auth/policies/:id/beneficiary", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    const clientOrgId = (req.session as any)?.clientOrgId;
    if (!clientId || !clientOrgId) return res.status(401).json({ message: "Not authenticated" });
    const policy = await storage.getPolicy(req.params.id as string, clientOrgId);
    if (!policy || policy.clientId !== clientId) return res.status(403).json({ message: "Access denied" });
    await storage.updatePolicy(policy.id, {
      beneficiaryFirstName: null,
      beneficiaryLastName: null,
      beneficiaryRelationship: null,
      beneficiaryNationalId: null,
      beneficiaryPhone: null,
      beneficiaryDependentId: null,
    }, clientOrgId);
    return res.json({ message: "Beneficiary removed" });
  });
}
