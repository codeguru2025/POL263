import type { Express } from "express";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import {
  streamAttendanceLogPDF,
  streamAttendanceLogBlankPDF,
  streamAttendanceQrPosterPDF,
  streamEmployeeEnrollmentPDF,
  streamEmployeeEnrollmentBlankPDF,
  streamVehicleRegistrationPDF,
  streamVehicleRegistrationBlankPDF,
  streamFuelLogPDF,
  streamFuelLogBlankPDF,
  streamMaintenanceRecordPDF,
  streamMaintenanceRecordBlankPDF,
  streamDriverAssignmentPDF,
  streamDriverAssignmentBlankPDF,
  streamLeadCapturePDF,
  streamLeadCaptureBlankPDF,
  streamVehicleTripLogPDF,
  streamVehicleTripLogBlankPDF,
} from "./hr-fleet-document";

export function registerHrFleetFormRoutes(app: Express): void {
  // ── Form 20: Attendance Log ───────────────────────────────────
  app.get(
    "/api/attendance/log-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:payroll"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamAttendanceLogPDF(user.organizationId, res, {
          attachment: req.query.download === "1",
          dateFrom: req.query.dateFrom as string | undefined,
          dateTo: req.query.dateTo as string | undefined,
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Attendance QR Kiosk Poster (A4, printable) ────────────────
  app.get(
    "/api/attendance/qr-codes/:id/poster-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("manage:attendance"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamAttendanceQrPosterPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 21: Employee Enrollment ──────────────────────────────
  app.get(
    "/api/payroll/employees/:id/enrollment-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:payroll"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamEmployeeEnrollmentPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 23: Vehicle Registration Record ─────────────────────
  app.get(
    "/api/fleet/:id/registration-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:fleet"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamVehicleRegistrationPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 24: Fuel Log ─────────────────────────────────────────
  app.get(
    "/api/fleet/:id/fuel-log-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:fleet"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamFuelLogPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 25: Maintenance Record ───────────────────────────────
  app.get(
    "/api/fleet/:id/maintenance-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:fleet"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamMaintenanceRecordPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 26: Driver Assignment Slip ───────────────────────────
  app.get(
    "/api/fleet/driver-assignments/:id/assignment-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:fleet"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamDriverAssignmentPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 27: Lead Capture Form ────────────────────────────────
  app.get(
    "/api/leads/:id/lead-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:lead"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamLeadCapturePDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Form 28: Vehicle Trip / Mileage Log ───────────────────────
  app.get(
    "/api/fleet/:id/trip-log-pdf",
    requireAuth,
    requireTenantScope,
    requirePermission("read:fleet"),
    async (req, res) => {
      const user = req.user as any;
      try {
        await streamVehicleTripLogPDF(req.params.id as string, user.organizationId, res, {
          attachment: req.query.download === "1",
        });
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Blank Forms ───────────────────────────────────────────────
  app.get("/api/forms/blank/attendance-log", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamAttendanceLogBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/employee-enrollment", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamEmployeeEnrollmentBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/vehicle-registration", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamVehicleRegistrationBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/fuel-log", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamFuelLogBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/maintenance-record", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamMaintenanceRecordBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/driver-assignment", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamDriverAssignmentBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/lead-capture", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamLeadCaptureBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });

  app.get("/api/forms/blank/vehicle-trip-log", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try { await streamVehicleTripLogBlankPDF(user.organizationId, res, { attachment: true }); }
    catch (err: any) { if (!res.headersSent) res.status(500).json({ message: err.message }); }
  });
}
