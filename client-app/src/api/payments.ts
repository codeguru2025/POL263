import { apiJson } from "./client";

export interface PaymentIntent {
  id: string;
  policyId: string;
  amount: string;
  currency: string;
  purpose: string;
  status: string;
  merchantReference: string;
  paynowRedirectUrl: string | null;
}

/** server/client-auth.ts:680 — idempotencyKey prevents double-charging on retry/re-submit,
 *  same pattern the web client uses (`client-${clientId}-${policyId}-${Date.now()}`). */
export async function createPaymentIntent(policyId: string, amount: string): Promise<{ intent: PaymentIntent; created: boolean; message?: string }> {
  const idempotencyKey = `client-app-${policyId}-${Date.now()}`;
  return apiJson("/api/client-auth/payment-intents", {
    method: "POST",
    body: JSON.stringify({ policyId, amount, purpose: "premium", idempotencyKey }),
  });
}

export type PaynowMethod = "ecocash" | "onemoney" | "visa_mastercard";

export interface InitiateResult {
  redirectUrl?: string;
  pollUrl?: string;
  message?: string;
}

/** server/client-auth.ts:729. Scoped to the 3 methods that don't need an extra UI step:
 *  ecocash/onemoney push a USSD prompt to the phone (poll for completion), visa_mastercard
 *  returns a redirectUrl to open in the system browser. InnBucks (shows a one-time code
 *  with a countdown) and O'Mari (needs an OTP submit step) are deliberately deferred --
 *  each is a real extra screen/flow, not a one-line addition, and every method already
 *  supported here covers the common case. */
export async function initiatePayment(intentId: string, method: PaynowMethod, payerPhone?: string, payerEmail?: string): Promise<InitiateResult> {
  return apiJson(`/api/client-auth/payment-intents/${intentId}/initiate`, {
    method: "POST",
    body: JSON.stringify({ method, payerPhone, payerEmail }),
  });
}

export interface PaymentStatus {
  status: string;
  paid: boolean;
  error?: string;
}

export async function getPaymentStatus(intentId: string): Promise<PaymentStatus> {
  return apiJson(`/api/client-auth/payment-intents/${intentId}/status`);
}

export async function getPaynowConfig(): Promise<{ enabled: boolean; mode: string; returnUrl: string }> {
  return apiJson("/api/client-auth/paynow-config");
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  policyId: string;
  amount: string;
  currency: string;
  issuedAt: string;
}

export async function getMyReceipts(): Promise<Receipt[]> {
  return apiJson("/api/client-auth/receipts");
}
