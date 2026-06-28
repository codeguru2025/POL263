import type { Express } from "express";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import {
  streamPaymentReceiptPDF,
  streamPaymentReceiptBlankPDF,
  streamCashupSheetPDF,
  streamCashupSheetBlankPDF,
  streamRequisitionFormPDF,
  streamRequisitionBlankPDF,
  streamExpenditureVoucherPDF,
  streamExpenditureVoucherBlankPDF,
} from "./finance-document";

export function registerFinanceFormRoutes(app: Express): void {
  // ── Form 16: Payment Receipt ──────────────────────────────────
  app.get(
    "/api/payments/:id/receipt-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:finance"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamPaymentReceiptPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 17: Daily Cashup Sheet ───────────────────────────────
  app.get(
    "/api/cashups/:id/cashup-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:finance"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamCashupSheetPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 18: Requisition Form ─────────────────────────────────
  app.get(
    "/api/requisitions/:id/requisition-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:finance"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamRequisitionFormPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 19: Expenditure Voucher ──────────────────────────────
  app.get(
    "/api/expenditures/:id/voucher-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:finance"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamExpenditureVoucherPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Blank Forms ───────────────────────────────────────────────
  app.get("/api/forms/blank/payment-receipt", requireAuth, async (req, res) => {
    try { await streamPaymentReceiptBlankPDF((req.user as any).organizationId, res); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/cashup-sheet", requireAuth, async (req, res) => {
    try { await streamCashupSheetBlankPDF((req.user as any).organizationId, res); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/requisition-form", requireAuth, async (req, res) => {
    try { await streamRequisitionBlankPDF((req.user as any).organizationId, res); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/expenditure-voucher", requireAuth, async (req, res) => {
    try { await streamExpenditureVoucherBlankPDF((req.user as any).organizationId, res); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });
}
