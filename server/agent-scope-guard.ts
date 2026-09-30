/**
 * One ownership check for agent-scoped users, in front of every route that takes a policy /
 * client / claim / lead / receipt / group id — instead of each route remembering its own check.
 * Before this, 60 of 73 such routes relied on the permission alone, so an agent holding another
 * agent's policy id could view or change it.
 *
 * Only users for whom isAgentScoped() is true are restricted (an agent who is also an
 * administrator/manager etc. is not). Ids that aren't UUIDs ("export", "legacy-receipts") and
 * records that don't exist pass through so the route itself answers (404 etc.).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "./storage";
import { isAgentScoped } from "@shared/roles";
import { resolveOrSyncTenantUserId } from "./tenant-db";

type Kind = "policy" | "client" | "claim" | "lead" | "receipt" | "group";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** true = the agent owns it, false = someone else's, null = no such record (let the route 404). */
export async function agentOwns(kind: Kind, id: string, agentId: string, orgId: string): Promise<boolean | null> {
  const policyOwned = async (policyId: string | null | undefined) => {
    if (!policyId) return false;
    const p = await storage.getPolicy(policyId, orgId);
    return p ? p.agentId === agentId : false;
  };
  switch (kind) {
    case "policy": {
      const p = await storage.getPolicy(id, orgId);
      return p ? p.agentId === agentId : null;
    }
    case "client":
      return (await storage.getClient(id, orgId)) ? storage.isClientAccessibleByAgent(agentId, id, orgId) : null;
    case "claim": {
      const c = await storage.getClaim(id, orgId);
      return c ? policyOwned(c.policyId) : null;
    }
    case "lead": {
      const l = await storage.getLead(id, orgId);
      return l ? (l as any).agentId === agentId : null;
    }
    case "receipt": {
      const r = await storage.getPaymentReceiptById(id, orgId);
      return r ? policyOwned(r.policyId) : null;
    }
    case "group": {
      // Agents only reach a group they are the responsible agent for.
      const g = await storage.getGroup(id, orgId);
      return g ? g.agentId === agentId : null;
    }
  }
}

function guard(kind: Kind) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const id = String(req.params.id ?? "");
      if (!user?.organizationId || user.isPlatformOwner || !UUID.test(id)) return next();
      const roles = await storage.getUserRoles(user.id, user.organizationId);
      if (!isAgentScoped(roles)) return next();
      const agentId = await resolveOrSyncTenantUserId(user.organizationId, user.id);
      const owns = await agentOwns(kind, id, agentId, user.organizationId);
      if (owns === false) return res.status(403).json({ message: "Access denied — this record belongs to another agent." });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Register before any route so it runs first. Covers sub-paths (/api/policies/:id/members …). */
export function registerAgentScopeGuard(app: Express): void {
  app.use("/api/policies/:id", guard("policy"));
  app.use("/api/clients/:id", guard("client"));
  app.use("/api/claims/:id", guard("claim"));
  app.use("/api/leads/:id", guard("lead"));
  app.use("/api/receipts/:id", guard("receipt"));
  app.use("/api/payment-receipts/:id", guard("receipt"));
  app.use("/api/groups/:id", guard("group"));
}
