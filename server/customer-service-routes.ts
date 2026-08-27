/**
 * Public (server-to-server) routes for the Customer-Service chatbot integration
 * (SMSALA WhatsApp bot "Pol263 Customer Service").
 *
 * Unauthenticated by session on purpose — SMSALA's servers call this, not a logged-in user.
 * Trust comes entirely from the per-tenant bearer shared secret verified in
 * server/customer-service-integration.ts (authenticateCustomerServiceRequest), the same "own
 * secret instead of a session" convention every other public webhook-style route here uses
 * (server/inbound-email-public-routes.ts, the PayNow result callback).
 *
 * CSRF: the exact path below is listed in server/index.ts CSRF_EXEMPT_PATHS.
 * Rate limiting: "/api/customer-service" has a dedicated limiter in server/index.ts.
 */
import type { Express } from "express";
import { handleVerifyRequest } from "./customer-service-integration";

export function registerCustomerServiceRoutes(app: Express): void {
  // Phase 1/2 — read-only customer verification. See handleVerifyRequest for the contract.
  app.post("/api/customer-service/verify", (req, res) => {
    void handleVerifyRequest(req, res);
  });
}
