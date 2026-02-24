import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { z } from "zod";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const CONSTANT_DELAY_MS = 200;

async function constantTimeResponse(res: Response, status: number, body: any) {
  await new Promise(resolve => setTimeout(resolve, CONSTANT_DELAY_MS));
  return res.status(status).json(body);
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
    const { clientId, password, securityQuestionId, securityAnswer } = req.body;
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

      const crypto = await import("crypto");
      const passwordHash = crypto.createHash("sha256").update(password).digest("hex");
      const normalizedAnswer = securityAnswer.trim().toLowerCase();
      const answerHash = crypto.createHash("sha256").update(normalizedAnswer).digest("hex");

      await storage.updateClient(clientId, {
        passwordHash,
        securityQuestionId,
        securityAnswerHash: answerHash,
        isEnrolled: true,
        activationCode: null,
      });

      structuredLog("info", "Client enrolled", { clientId });
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

      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(password).digest("hex");

      if (hash !== client.passwordHash) {
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

      const crypto = await import("crypto");
      const normalizedAnswer = securityAnswer.trim().toLowerCase();
      const answerHash = crypto.createHash("sha256").update(normalizedAnswer).digest("hex");

      if (answerHash !== client.securityAnswerHash) {
        return constantTimeResponse(res, 400, { message: "Invalid request" });
      }

      const newHash = crypto.createHash("sha256").update(newPassword).digest("hex");
      await storage.updateClient(client.id, { passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null });

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
}
