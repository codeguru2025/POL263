import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentIntent, handlePaynowResult } from "../../server/payment-service";

const mockIntent = {
  id: "intent-1",
  organizationId: "org-1",
  clientId: "client-1",
  policyId: "policy-1",
  status: "created",
  merchantReference: "ORG-POL001-20260226-120000-abc123",
  amount: "10",
  currency: "USD",
  purpose: "premium",
  idempotencyKey: "key-1",
  methodSelected: "unknown",
  createdAt: new Date(),
  updatedAt: new Date(),
  paynowPollUrl: null,
  paynowRedirectUrl: null,
  paynowReference: null,
};

vi.mock("../../server/storage", () => ({
  storage: {
    getPaymentIntentByOrgAndIdempotencyKey: vi.fn(),
    getPolicy: vi.fn(),
    getOrganization: vi.fn(),
    createPaymentIntent: vi.fn(),
    createPaymentEvent: vi.fn(),
    getOrganizations: vi.fn(),
    getPaymentIntentByMerchantReference: vi.fn(),
    updatePaymentIntent: vi.fn(),
  },
}));

vi.mock("../../server/paynow-hash", () => ({
  verifyPaynowHash: vi.fn(() => true),
}));

const storage = (await import("../../server/storage")).storage;

describe("PaymentService", () => {
  beforeEach(() => {
    vi.mocked(storage.getPolicy).mockResolvedValue({
      id: "policy-1",
      policyNumber: "POL001",
      status: "active",
      clientId: "client-1",
      organizationId: "org-1",
      currency: "USD",
      premiumAmount: "10",
    } as any);
    vi.mocked(storage.getOrganization).mockResolvedValue({ id: "org-1", name: "Test Org" } as any);
  });

  describe("createPaymentIntent idempotency", () => {
    it("returns existing intent when idempotency key matches", async () => {
      vi.mocked(storage.getPaymentIntentByOrgAndIdempotencyKey).mockResolvedValue({ ...mockIntent, status: "created" } as any);
      vi.mocked(storage.createPaymentIntent).mockReset();

      const result = await createPaymentIntent({
        organizationId: "org-1",
        clientId: "client-1",
        policyId: "policy-1",
        amount: "10",
        idempotencyKey: "key-1",
      });

      expect(result.created).toBe(false);
      expect(result.intent).toBeDefined();
      expect(result.intent.id).toBe("intent-1");
      expect(storage.createPaymentIntent).not.toHaveBeenCalled();
    });

    it("creates new intent when idempotency key is new", async () => {
      vi.mocked(storage.getPaymentIntentByOrgAndIdempotencyKey).mockResolvedValue(null);
      vi.mocked(storage.createPaymentIntent).mockResolvedValue({ ...mockIntent } as any);

      const result = await createPaymentIntent({
        organizationId: "org-1",
        clientId: "client-1",
        policyId: "policy-1",
        amount: "10",
        idempotencyKey: "new-key",
      });

      expect(result.created).toBe(true);
      expect(storage.createPaymentIntent).toHaveBeenCalled();
    });
  });

  describe("handlePaynowResult webhook double-delivery", () => {
    it("returns ok without double-apply when intent already paid", async () => {
      vi.mocked(storage.getOrganizations).mockResolvedValue([{ id: "org-1" }] as any);
      vi.mocked(storage.getPaymentIntentByMerchantReference).mockResolvedValue({
        ...mockIntent,
        status: "paid",
      } as any);

      const result = await handlePaynowResult({
        reference: "ORG-POL001-20260226-120000-abc123",
        status: "paid",
        hash: "valid",
      });

      expect(result.ok).toBe(true);
      // When intent.status === "paid", handlePaynowResult returns early and does not call applyPaymentToPolicy again
      expect(storage.updatePaymentIntent).not.toHaveBeenCalled();
    });
  });
});
