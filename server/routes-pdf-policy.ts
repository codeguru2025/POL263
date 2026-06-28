import type { Express } from "express";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import {
  streamClientRegistrationPDF,
  streamClientRegistrationBlankPDF,
  streamPolicyApplicationPDF,
  streamPolicyApplicationBlankPDF,
  streamDependentRegistrationPDF,
  streamDependentRegistrationBlankPDF,
  streamWaiverRequestPDF,
  streamWaiverRequestBlankPDF,
  streamDebitOrderMandateBlankPDF,
  streamClaimSubmissionPDF,
  streamClaimSubmissionBlankPDF,
} from "./policy-client-forms";
import { storage } from "./storage";

export function registerPolicyFormRoutes(app: Express): void {
  // ── Form 10: Client Registration ─────────────────────────────
  app.get(
    "/api/clients/:id/registration-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:client"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamClientRegistrationPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 12: Dependent Registration ──────────────────────────
  app.get(
    "/api/clients/:id/dependents-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:client"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamDependentRegistrationPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 11: Policy Application ───────────────────────────────
  app.get(
    "/api/policies/:id/application-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:policy"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamPolicyApplicationPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 13: Waiting Period Waiver Request ────────────────────
  app.get(
    "/api/waiting-period-waivers/:id/waiver-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("manage:approvals"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamWaiverRequestPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 15: Claim Submission ─────────────────────────────────
  app.get(
    "/api/claims/:id/submission-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:claim"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamClaimSubmissionPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Blank Forms ───────────────────────────────────────────────
  app.get("/api/forms/blank/client-registration", requireAuth, (_req, res) => {
    try { streamClientRegistrationBlankPDF(res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/policy-application", requireAuth, (_req, res) => {
    try { streamPolicyApplicationBlankPDF(res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/dependent-registration", requireAuth, (_req, res) => {
    try { streamDependentRegistrationBlankPDF(res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/waiver-request", requireAuth, (_req, res) => {
    try { streamWaiverRequestBlankPDF(res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/debit-order-mandate", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const org = await storage.getOrganization(user.organizationId);
      streamDebitOrderMandateBlankPDF(res, org?.name ?? null, { attachment: true });
    } catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/claim-submission", requireAuth, (_req, res) => {
    try { streamClaimSubmissionBlankPDF(res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });
}
