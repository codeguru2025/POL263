import type { Express } from "express";
import { requireAuth, requireTenantScope, requirePermission } from "./auth";

export function registerMortuaryFormRoutes(app: Express): void {
  // ── Blank forms (no record needed) ───────────────────────────
  app.get("/api/forms/blank/mortuary-intake", requireAuth, async (_req, res) => {
    const { streamMortuaryIntakeBlankPDF } = await import("./mortuary-document");
    await streamMortuaryIntakeBlankPDF(res);
  });

  app.get("/api/forms/blank/mortuary-dispatch", requireAuth, async (_req, res) => {
    const { streamMortuaryDispatchBlankPDF } = await import("./mortuary-document");
    await streamMortuaryDispatchBlankPDF(res);
  });

  app.get("/api/forms/blank/deceased-belongings", requireAuth, async (_req, res) => {
    const { streamBelongingsBlankPDF } = await import("./mortuary-document");
    await streamBelongingsBlankPDF(res);
  });

  app.get("/api/forms/blank/body-wash", requireAuth, async (_req, res) => {
    const { streamBodyWashBlankPDF } = await import("./mortuary-document");
    await streamBodyWashBlankPDF(res);
  });

  app.get("/api/forms/blank/driver-checklist", requireAuth, async (_req, res) => {
    const { streamDriverChecklistBlankPDF } = await import("./mortuary-document");
    await streamDriverChecklistBlankPDF(res);
  });

  app.get("/api/forms/blank/funeral-case-worksheet", requireAuth, async (_req, res) => {
    const { streamFuneralCaseWorksheetBlankPDF } = await import("./mortuary-document");
    await streamFuneralCaseWorksheetBlankPDF(res);
  });

  app.get("/api/forms/blank/storage-receipt", requireAuth, async (_req, res) => {
    const { streamStorageReceiptBlankPDF } = await import("./mortuary-document");
    await streamStorageReceiptBlankPDF(res);
  });

  app.get("/api/forms/blank/funeral-quotation", requireAuth, async (_req, res) => {
    const { streamFuneralQuotationBlankPDF } = await import("./mortuary-document");
    await streamFuneralQuotationBlankPDF(res);
  });

  // ── Pre-filled forms (from record) ────────────────────────────
  app.get("/api/mortuary-intakes/:id/belongings-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamBelongingsFormPDF } = await import("./mortuary-document");
    await streamBelongingsFormPDF(req.params.id as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });

  app.get("/api/mortuary-intakes/:id/body-wash-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamBodyWashFormPDF } = await import("./mortuary-document");
    await streamBodyWashFormPDF(req.params.id as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });

  app.get("/api/mortuary-intakes/:id/storage-receipt-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamStorageReceiptPDF } = await import("./mortuary-document");
    await streamStorageReceiptPDF(req.params.id as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });

  app.get("/api/funeral-cases/:id/worksheet-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamFuneralCaseWorksheetPDF } = await import("./mortuary-document");
    await streamFuneralCaseWorksheetPDF(req.params.id as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });

  app.get("/api/funeral-cases/:id/tasks-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamFuneralTaskSheetPDF } = await import("./mortuary-document");
    await streamFuneralTaskSheetPDF(req.params.id as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });
}
