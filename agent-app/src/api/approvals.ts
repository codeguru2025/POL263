import { apiJson, type ApiError } from "./client";

export interface ApprovalSummaryCategory {
  key: string;
  label: string;
  count: number;
  nativeUrl: string;
}

export interface ApprovalSummary {
  totalCount: number;
  categories: ApprovalSummaryCategory[];
}

/** server/routes.ts:7965 — read-only aggregation across all 5 approval systems.
 *  Only "requests" is actionable in this app (getApprovalRequests/resolve below);
 *  the rest (waivers, settlements, receipts, requisitions) are shown as counts only,
 *  same as the web app's own summary widget links out to their native pages. */
export async function getApprovalSummary(): Promise<ApprovalSummary> {
  return apiJson("/api/approvals/summary");
}

export interface ApprovalRequest {
  id: string;
  requestType: string;
  entityType: string;
  entityId: string;
  requestData: Record<string, unknown> | null;
  status: string;
  initiatedBy: string;
  approvedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Requires approve:requests — a 403 here means this staff member can see the tab
 *  (any staff role) but doesn't hold the permission to act on generic requests;
 *  callers should treat that as an empty/gated state, not a crash. */
export async function getApprovalRequests(status?: string): Promise<ApprovalRequest[]> {
  const params = status ? `?status=${status}` : "";
  return apiJson(`/api/approvals${params}`);
}

export async function resolveApprovalRequest(
  id: string,
  action: "approve" | "reject",
  rejectionReason?: string
): Promise<ApprovalRequest> {
  return apiJson(`/api/approvals/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, rejectionReason }),
  });
}

export function isForbidden(err: unknown): boolean {
  return (err as ApiError)?.status === 403;
}
