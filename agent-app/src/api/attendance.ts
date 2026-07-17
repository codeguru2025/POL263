import { apiJson } from "./client";

export interface AttendanceLog {
  id: string;
  date: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  approvalNotes: string | null;
  source: "manual" | "qr";
  clockInAt: string | null;
  clockOutAt: string | null;
  hoursWorked: string | null;
  clockInOffSite: boolean;
  clockOutOffSite: boolean;
}

export interface ScanResult {
  eventType: "clock_in" | "clock_out";
  log: AttendanceLog;
  activeVehicleCheckout: { assignmentId: string; vehicleId: string; registration: string | null } | null;
}

/** Mirrors server's recordAttendanceScan contract exactly (server/routes.ts:8567) —
 *  qrToken from the scanned QR, lat/lng best-effort (server proceeds without them). */
export async function scanAttendance(qrToken: string, latitude?: number, longitude?: number): Promise<ScanResult> {
  return apiJson("/api/attendance/scan", {
    method: "POST",
    body: JSON.stringify({ qrToken, latitude, longitude }),
  });
}

export async function getMyAttendance(): Promise<AttendanceLog[]> {
  return apiJson("/api/attendance/my");
}

export interface LiveAttendanceStats {
  date: string;
  totalActiveEmployees: number;
  currentlyInCount: number;
  clockedOutToday: number;
  notYetIn: number;
  pendingApprovals: number;
  offSiteFlags: number;
  currentlyIn: {
    logId: string;
    employeeId: string;
    name: string;
    employeeNumber: string;
    position: string | null;
    department: string | null;
    clockInAt: string;
    offSite: boolean;
  }[];
  byDepartment: { department: string; count: number }[];
}

/** Requires read:payroll — most agents won't have it (matches web app's Team Attendance
 *  gating). Caller should check permissions before showing this, and treat a 403 as
 *  "no access" rather than an error. */
export async function getLiveAttendance(): Promise<LiveAttendanceStats> {
  return apiJson("/api/attendance/live");
}
