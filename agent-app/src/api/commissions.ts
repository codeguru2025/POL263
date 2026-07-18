import { apiJson } from "./client";

export interface AgentPnl {
  agentId: string;
  period: { from: string; to: string };
  portfolio: {
    totalPolicies: number;
    activePolicies: number;
    gracePolicies: number;
    lapsedPolicies: number;
    newInPeriod: number;
    retentionRate: string;
  };
  collections: {
    total: Record<string, number>;
    byMonth: { month: string; amounts: Record<string, number> }[];
  };
  commissions: {
    earned: Record<string, number>;
    paid: Record<string, number>;
    outstanding: Record<string, number>;
    clawbacks: Record<string, number>;
    rollbacks: Record<string, number>;
  };
  lifetimeOutstanding: Record<string, number>;
}

/** server/routes.ts:6232 — agents always see their own P&L (server resolves
 *  agentId server-side when the caller is agent-scoped); no ?agentId needed
 *  or accepted from this app. Uses the server's own default statement period
 *  (defaultStatementRange) rather than a client-side date picker, matching
 *  this pass's no-custom-date-range scope. */
export async function getMyPnl(): Promise<AgentPnl> {
  return apiJson("/api/agent/pnl");
}

export interface CommissionLedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  currency: string;
  description: string | null;
  status: string;
  createdAt: string;
  policyId: string | null;
  policyNumber: string | null;
  policyStatus: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
}

/** server/routes.ts:6219 — agent-scoped server-side, same pattern as pnl. */
export async function getMyCommissionLedger(): Promise<CommissionLedgerEntry[]> {
  return apiJson("/api/commission-ledger?limit=200");
}
