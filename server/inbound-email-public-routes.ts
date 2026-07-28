/**
 * Receives Resend's inbound-email webhook (event.type "email.received") for any tenant
 * subdomain provisioned via server/email-domain-provisioning.ts. Unauthenticated by
 * necessity (Resend's servers call this, not a logged-in user) — trust comes entirely from
 * Svix signature verification against RESEND_WEBHOOK_SECRET, same as every other public
 * webhook-style route in this codebase relies on its own signature/hash check instead of
 * session auth (see server/payment-service.ts's PayNow hash verification).
 *
 * NOTE: Resend's exact inbound webhook payload shape and the "fetch full message" endpoint
 * were not confirmed against live API docs when this was written (only a summarized doc
 * fetch) — the raw event is logged on any parse failure so the real shape can be read back
 * from logs and this file adjusted once a live test email has actually been received.
 */
import type { Express, Request, Response } from "express";
import { Webhook } from "svix";
import { resolveTenantBySubdomain } from "./email-domain-provisioning";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { hasModule } from "./module-gate";

const RESEND_API_BASE = "https://api.resend.com";

function extractSubdomain(toAddress: string): string | null {
  // Handles both a bare address and RFC 5322 "Display Name <addr@domain>" formatting —
  // the exact shape Resend sends wasn't confirmed against live docs, so this is defensive.
  const bracketMatch = /<([^>]+)>/.exec(toAddress);
  const addr = (bracketMatch ? bracketMatch[1] : toAddress).trim();
  const match = /@([^@\s]+)$/.exec(addr);
  return match ? match[1].toLowerCase() : null;
}

async function fetchFullInboundEmail(emailId: string): Promise<{ subject?: string; text?: string; html?: string } | null> {
  const key = process.env.RESEND_MANAGEMENT_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails/${emailId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      structuredLog("warn", "Failed to fetch full inbound email content", { emailId, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    structuredLog("warn", "Failed to fetch full inbound email content", { emailId, error: (err as Error).message });
    return null;
  }
}

export function registerInboundEmailPublicRoutes(app: Express): void {
  app.post("/api/public/inbound-email/webhook", async (req: Request, res: Response) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      structuredLog("error", "Inbound email webhook received but RESEND_WEBHOOK_SECRET not configured");
      return res.status(200).send("ignored");
    }

    const rawBody = req.rawBody as Buffer | undefined;
    if (!rawBody) {
      structuredLog("warn", "Inbound email webhook missing raw body — cannot verify signature");
      return res.status(200).send("ignored");
    }

    let event: any;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(rawBody.toString("utf8"), {
        "svix-id": String(req.headers["svix-id"] || ""),
        "svix-timestamp": String(req.headers["svix-timestamp"] || ""),
        "svix-signature": String(req.headers["svix-signature"] || ""),
      });
    } catch (err) {
      structuredLog("warn", "Inbound email webhook signature verification failed", { error: (err as Error).message });
      return res.status(401).send("invalid signature");
    }

    // Always 200 past this point — a malformed/unrecognized-but-signed event shouldn't
    // trigger Resend retries, same "don't retry" convention as the PayNow webhook
    // (server/routes.ts's "/api/payments/paynow/result" handler).
    try {
      if (event?.type !== "email.received") {
        return res.status(200).send("ignored");
      }

      const toRaw = event.data?.to;
      const toAddress = String(Array.isArray(toRaw) ? toRaw[0] : toRaw || "");
      const fromAddress = String(event.data?.from || "");
      const emailId = event.data?.email_id as string | undefined;
      if (!toAddress || !emailId) {
        structuredLog("warn", "Inbound email webhook event missing to/email_id — check payload shape", { event });
        return res.status(200).send("ok");
      }

      const subdomain = extractSubdomain(toAddress);
      if (!subdomain) return res.status(200).send("ok");

      const tenant = await resolveTenantBySubdomain(subdomain);
      if (!tenant || !tenant.receivingEnabled) {
        structuredLog("info", "Inbound email for unmapped or DNS-disabled subdomain — dropped", { subdomain });
        return res.status(200).send("ok");
      }
      // Resend has no API to un-set receiving once granted, so tenantEmailDomains.receivingEnabled
      // alone can't reflect a platform owner turning "email_inbound" back off — the tenantFeatureFlags
      // check is the actual authority for whether mail should still be stored.
      if (!(await hasModule(tenant.tenantId, "email_inbound"))) {
        structuredLog("info", "Inbound email for a tenant with email_inbound disabled — dropped", { subdomain, tenantId: tenant.tenantId });
        return res.status(200).send("ok");
      }

      const full = await fetchFullInboundEmail(emailId);
      await storage.createInboundEmail({
        organizationId: tenant.tenantId,
        fromAddress,
        toAddress,
        subject: full?.subject ?? null,
        bodyText: full?.text ?? null,
        bodyHtml: full?.html ?? null,
        resendEmailId: emailId,
        receivedAt: new Date(),
      });

      return res.status(200).send("ok");
    } catch (err) {
      structuredLog("error", "Inbound email webhook processing failed", { error: (err as Error).message });
      return res.status(200).send("ok");
    }
  });
}
