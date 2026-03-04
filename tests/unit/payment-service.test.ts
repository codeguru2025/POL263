import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentIntent, handlePaynowResult, applyPaymentToPolicy } from "../../server/payment-service";

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
  methodSelected: "ecocash",
  createdAt: new Date(),
  updatedAt: new Date(),
  paynowPollUrl: null,
  paynowRedirectUrl: null,
  paynowReference: "PAYNOW-REF-123",
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
    getPaymentReceiptsByPolicy: vi.fn(),
    createPaymentTransaction: vi.fn(),
    getNextPaymentReceiptNumber: vi.fn(),
    createPaymentReceipt: vi.fn(),
    updatePaymentReceipt: vi.fn(),
    updatePolicy: vi.fn(),
    createPolicyStatusHistory: vi.fn(),
    getCommissionEntriesByPolicy: vi.fn(),
    createCommissionLedgerEntry: vi.fn(),
    createNotificationLog: vi.fn(),
  },
  findPaymentIntentById: vi.fn(),
}));

vi.mock("../../server/paynow-hash", () => ({
  verifyPaynowHash: vi.fn(() => true),
}));

vi.mock("../../server/receipt-pdf", () => ({
  generateReceiptPdf: vi.fn(() => Promise.resolve(null)),
}));

const storage = (await import("../../server/storage")).storage;
const findPaymentIntentById = (await import("../../server/storage")).findPaymentIntentById;

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

  describe("applyPaymentToPolicy receipting (online PayNow)", () => {
    it("creates payment transaction and receipt with receipt number and transactionId in metadata when intent not paid", async () => {
      vi.mocked(findPaymentIntentById).mockResolvedValue({ ...mockIntent, status: "created" } as any);
      vi.mocked(storage.getPaymentReceiptsByPolicy).mockResolvedValue([]);
      vi.mocked(storage.getPolicy).mockResolvedValue({
        id: "policy-1",
        policyNumber: "POL001",
        status: "active",
        clientId: "client-1",
        organizationId: "org-1",
        branchId: null,
        currency: "USD",
        premiumAmount: "10",
      } as any);
      const mockTx = { id: "tx-1", amount: "10", currency: "USD", status: "cleared" };
      const mockReceipt = { id: "receipt-1", receiptNumber: "2", metadataJson: { transactionId: "tx-1", paynowReference: "PAYNOW-REF-123" } };
      vi.mocked(storage.createPaymentTransaction).mockResolvedValue(mockTx as any);
      vi.mocked(storage.getNextPaymentReceiptNumber).mockResolvedValue("2");
      vi.mocked(storage.createPaymentReceipt).mockResolvedValue(mockReceipt as any);
      vi.mocked(storage.updatePaymentIntent).mockResolvedValue(undefined as any);
      vi.mocked(storage.createPaymentEvent).mockResolvedValue(undefined as any);
      vi.mocked(storage.updatePolicy).mockResolvedValue(undefined as any);
      vi.mocked(storage.createPolicyStatusHistory).mockResolvedValue(undefined as any);
      vi.mocked(storage.getCommissionEntriesByPolicy).mockResolvedValue([]);
      vi.mocked(storage.updatePaymentReceipt).mockResolvedValue(undefined as any);
      vi.mocked(storage.createNotificationLog).mockResolvedValue(undefined as any);

      const result = await applyPaymentToPolicy("intent-1", "system", null);

      expect(result.ok).toBe(true);
      expect(result.transactionId).toBe("tx-1");
      expect(result.receiptId).toBe("receipt-1");
      expect(storage.createPaymentTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          policyId: "policy-1",
          clientId: "client-1",
          amount: "10",
          currency: "USD",
          status: "cleared",
          paymentMethod: "paynow",
          reference: mockIntent.merchantReference,
          paynowReference: "PAYNOW-REF-123",
          idempotencyKey: "paynow-intent-1",
        })
      );
      expect(storage.getNextPaymentReceiptNumber).toHaveBeenCalledWith("org-1");
      expect(storage.createPaymentReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          policyId: "policy-1",
          clientId: "client-1",
          receiptNumber: "2",
          paymentIntentId: "intent-1",
          amount: "10",
          currency: "USD",
          status: "issued",
          metadataJson: { transactionId: "tx-1", paynowReference: "PAYNOW-REF-123" },
        })
      );
      expect(storage.updatePaymentIntent).toHaveBeenCalledWith("intent-1", { status: "paid" }, "org-1");
    });

    it("returns existing receipt when intent already paid (idempotent)", async () => {
      vi.mocked(findPaymentIntentById).mockResolvedValue({ ...mockIntent, status: "paid" } as any);
      const existingReceipt = { id: "existing-receipt", receiptNumber: "1", paymentIntentId: "intent-1" };
      vi.mocked(storage.getPaymentReceiptsByPolicy).mockResolvedValue([existingReceipt] as any);
      vi.mocked(storage.createPaymentTransaction).mockReset();
      vi.mocked(storage.createPaymentReceipt).mockReset();

      const result = await applyPaymentToPolicy("intent-1", "system", null);

      expect(result.ok).toBe(true);
      expect(result.receiptId).toBe("existing-receipt");
      expect(storage.createPaymentTransaction).not.toHaveBeenCalled();
      expect(storage.createPaymentReceipt).not.toHaveBeenCalled();
    });
  });
});
