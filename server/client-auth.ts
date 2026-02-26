import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { z } from "zod";
import argon2 from "argon2";
import { createPaymentIntent, initiatePaynowPayment, pollPaynowStatus } from "../payment-service";
import { getPaynowConfig } from "../paynow-config";

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

      const client = await storage.getClientByActivationCode(activationCode, orgs[0].id);
      if (!client) {
        return constantTimeResponse(res, 400, { message: "Invalid activation code or policy number" });
      }

      const policy = await storage.getPolicyByNumber(policyNumber, orgs[0].id);
      if (!policy || policy.clientId !== client.id) {
        return constantTimeResponse(res, 400, { message: "Invalid activation code or policy number" });
      }

      if (client.isEnrolled) {
        return constantTimeResponse(res, 400, { message: "This policy has already been claimed" });
      }

      const questions = await storage.getSecurityQuestions(orgs[0].id);

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

    try {
      const client = await storage.getClient(clientId);
      if (!client || client.isEnrolled) {
        return res.status(400).json({ message: "Invalid enrollment request" });
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
      });

      if (referralCode) {
        const agent = await storage.getUserByReferralCode(referralCode);
        if (agent) {
          const clientPolicies = await storage.getPoliciesByClient(clientId);
          for (const policy of clientPolicies) {
            if (!policy.agentId) {
              await storage.updatePolicy(policy.id, { agentId: agent.id });
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

      const policy = await storage.getPolicyByNumber(policyNumber, orgs[0].id);
      if (!policy) {
        return constantTimeResponse(res, 401, { message: "Invalid credentials" });
      }

      const client = await storage.getClient(policy.clientId);
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
        await storage.updateClient(client.id, updateData);
        return constantTimeResponse(res, 401, { message: "Invalid credentials" });
      }

      await storage.updateClient(client.id, { failedLoginAttempts: 0, lockedUntil: null });

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
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const client = await storage.getClient(clientId);
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

  app.get("/api/client-auth/policies", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const clientPolicies = await storage.getPoliciesByClient(clientId);
    return res.json(clientPolicies);
  });

  app.get("/api/client-auth/policies/:id/payments", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.clientId !== clientId) {
      return res.status(403).json({ message: "Access denied" });
    }
    return res.json(await storage.getPaymentsByPolicy(policy.id));
  });

  app.get("/api/client-auth/policies/:id/members", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.clientId !== clientId) {
      return res.status(403).json({ message: "Access denied" });
    }
    return res.json(await storage.getPolicyMembers(policy.id));
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

      const policy = await storage.getPolicyByNumber(policyNumber, orgs[0].id);
      if (!policy) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      const client = await storage.getClient(policy.clientId);
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
      });

      return constantTimeResponse(res, 200, { message: "Password reset successful" });
    } catch (err) {
      return constantTimeResponse(res, 500, { message: "Internal server error" });
    }
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
    const { policyId, amount, purpose, idempotencyKey } = req.body;
    if (!policyId || amount == null || !idempotencyKey) {
      return res.status(400).json({ message: "policyId, amount, and idempotencyKey are required" });
    }
    const policy = await storage.getPolicy(policyId);
    if (!policy || policy.clientId !== clientId || policy.organizationId !== clientOrgId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const result = await createPaymentIntent({
      organizationId: clientOrgId,
      clientId,
      policyId,
      amount: String(amount),
      purpose: purpose || "premium",
      idempotencyKey,
    });
    if (result.error) return res.status(400).json({ message: result.error });
    return res.json({ intent: result.intent, created: result.created });
  });

  app.post("/api/client-auth/payment-intents/:id/initiate", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) return res.status(401).json({ message: "Not authenticated" });
    const intent = await storage.getPaymentIntentById(req.params.id);
    if (!intent || intent.clientId !== clientId) return res.status(404).json({ message: "Not found" });
    const { method, payerPhone, payerEmail } = req.body;
    const result = await initiatePaynowPayment({
      intentId: intent.id,
      method: method || "visa_mastercard",
      payerPhone,
      payerEmail,
      actorType: "client",
      actorId: clientId,
    });
    if (!result.ok) return res.status(400).json({ message: result.error });
    return res.json({ redirectUrl: result.redirectUrl, pollUrl: result.pollUrl });
  });

  app.get("/api/client-auth/payment-intents/:id/status", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) return res.status(401).json({ message: "Not authenticated" });
    const intent = await storage.getPaymentIntentById(req.params.id);
    if (!intent || intent.clientId !== clientId) return res.status(404).json({ message: "Not found" });
    const result = await pollPaynowStatus(intent.id);
    return res.json({ status: result.status, paid: result.paid, error: result.error });
  });

  app.get("/api/client-auth/payment-intents", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) return res.status(401).json({ message: "Not authenticated" });
    const intents = await storage.getPaymentIntentsByClient(clientId);
    return res.json(intents);
  });

  app.get("/api/client-auth/receipts", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) return res.status(401).json({ message: "Not authenticated" });
    const receipts = await storage.getPaymentReceiptsByClient(clientId);
    return res.json(receipts);
  });

  app.get("/api/client-auth/receipts/:id/download", async (req: Request, res: Response) => {
    const clientId = (req.session as any)?.clientId;
    if (!clientId) return res.status(401).json({ message: "Not authenticated" });
    const receipt = await storage.getPaymentReceiptById(req.params.id);
    if (!receipt || receipt.clientId !== clientId) return res.status(404).json({ message: "Not found" });
    const { getReceiptPdfPath } = await import("../receipt-pdf");
    const filePath = getReceiptPdfPath(receipt.pdfStorageKey);
    if (!filePath) return res.status(404).json({ message: "Receipt PDF not available" });
    return res.download(filePath, `receipt-${receipt.receiptNumber}.pdf`);
  });

  app.get("/api/client-auth/paynow-config", (_req: Request, res: Response) => {
    const config = getPaynowConfig();
    return res.json({
      enabled: config.enabled,
      mode: config.mode,
      returnUrl: config.returnUrl,
    });
  });
}
