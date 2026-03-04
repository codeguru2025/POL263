/**
 * Simulate cash and PayNow payments and verify receipting.
 * Usage: npx tsx script/simulate-payment-receipt.ts
 * Requires .env with DATABASE_URL and existing org + policy + client.
 * Optional: POLICY_ID, ORG_ID to target a specific policy; otherwise uses first available.
 */
import "dotenv/config";
import { storage } from "../server/storage";
import { withOrgTransaction, getDbForOrg } from "../server/tenant-db";
import { applyPaymentToPolicy } from "../server/payment-service";
import { db } from "../server/db";
import { organizations, policies, paymentTransactions, paymentReceipts } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const orgs = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!orgs.length) {
    console.error("No organization found. Run db:seed first.");
    process.exit(1);
  }
  const orgId = process.env.ORG_ID || orgs[0].id;

  const tdb = await getDbForOrg(orgId);
  const policyRows = await tdb.select().from(policies).where(eq(policies.organizationId, orgId)).limit(5);
  const policy = policyRows.find((p) => p.clientId) || policyRows[0];
  if (!policy?.clientId) {
    console.error("No policy with client found. Create a policy first.");
    process.exit(1);
  }
  const policyId = process.env.POLICY_ID || policy.id;

  const policyFull = await storage.getPolicy(policyId, orgId);
  if (!policyFull) {
    console.error("Policy not found:", policyId);
    process.exit(1);
  }
  const clientId = policyFull.clientId;

  console.log("Using org:", orgId, "policy:", policyId, "client:", clientId);
  console.log("");

  // ─── 1. Simulate cash payment (same flow as POST /api/payments) ───
  console.log("1. Simulating CASH payment...");
  const cashAmount = "1.00";
  const cashCurrency = policyFull.currency || "USD";

  const cashResult = await withOrgTransaction(orgId, async (txDb) => {
    const [tx] = await txDb
      .insert(paymentTransactions)
      .values({
        organizationId: orgId,
        policyId: policyId,
        clientId: clientId,
        amount: cashAmount,
        currency: cashCurrency,
        paymentMethod: "cash",
        status: "cleared",
        reference: "SIM-CASH-" + Date.now(),
      })
      .returning();

    const receiptNumber = await storage.getNextPaymentReceiptNumber(orgId);
    const [receipt] = await txDb
      .insert(paymentReceipts)
      .values({
        organizationId: orgId,
        policyId: policyId,
        clientId: clientId,
        receiptNumber,
        amount: cashAmount,
        currency: cashCurrency,
        paymentChannel: "cash",
        status: "issued",
        printFormat: "thermal_80mm",
        metadataJson: { transactionId: tx.id, notes: "Simulated cash payment" },
      })
      .returning();

    return { tx, receipt };
  });

  console.log("   Cash transaction id:", cashResult.tx.id);
  console.log("   Cash receipt number:", cashResult.receipt.receiptNumber);
  console.log("   Receipt metadataJson.transactionId:", (cashResult.receipt.metadataJson as any)?.transactionId);
  const cashReceiptOk =
    (cashResult.receipt.metadataJson as any)?.transactionId === cashResult.tx.id &&
    !!cashResult.receipt.receiptNumber;
  console.log("   Cash receipting OK:", cashReceiptOk);
  console.log("");

  // ─── 2. Simulate PayNow payment (create intent then apply) ───
  console.log("2. Simulating PAYNOW (online) payment...");
  const intentData = {
    organizationId: orgId,
    clientId: clientId,
    policyId: policyId,
    amount: "2.00",
    currency: cashCurrency,
    purpose: "premium" as const,
    idempotencyKey: "sim-paynow-" + Date.now(),
    merchantReference: "SIM-PAYNOW-" + Date.now(),
  };
  const intent = await storage.createPaymentIntent(intentData as any);
  console.log("   Created payment intent id:", intent.id);

  const applyResult = await applyPaymentToPolicy(intent.id, "system", null);
  if (!applyResult.ok) {
    console.error("   applyPaymentToPolicy failed:", applyResult.error);
    process.exit(1);
  }
  console.log("   applyPaymentToPolicy ok, transactionId:", applyResult.transactionId, "receiptId:", applyResult.receiptId);

  const receipts = await storage.getPaymentReceiptsByPolicy(policyId, orgId);
  const paynowReceipt = receipts.find((r) => r.paymentIntentId === intent.id);
  if (!paynowReceipt) {
    console.error("   PayNow receipt not found by paymentIntentId");
    process.exit(1);
  }
  const paynowTxId = (paynowReceipt.metadataJson as any)?.transactionId;
  const paynowReceiptOk =
    !!paynowReceipt.receiptNumber && !!paynowTxId && paynowTxId === applyResult.transactionId;
  console.log("   PayNow receipt number:", paynowReceipt.receiptNumber);
  console.log("   PayNow receipt metadataJson.transactionId:", paynowTxId);
  console.log("   PayNow receipting OK:", paynowReceiptOk);
  console.log("");

  // ─── 3. Verify e-statement would show both ───
  const payments = await storage.getPaymentsByPolicy(policyId, orgId);
  const allReceipts = await storage.getPaymentReceiptsByPolicy(policyId, orgId);
  const receiptMap: Record<string, string> = {};
  for (const r of allReceipts) {
    const meta = r.metadataJson as { transactionId?: string } | null;
    if (meta?.transactionId) receiptMap[meta.transactionId] = r.receiptNumber;
  }
  const clearedPayments = payments.filter((p) => p.status === "cleared");
  const paymentsWithReceipt = clearedPayments.filter((p) => receiptMap[p.id]);
  console.log("3. E-statement check: payments with receipt number");
  console.log("   Cleared payments for policy:", clearedPayments.length);
  console.log("   Cleared payments with linked receipt:", paymentsWithReceipt.length);
  console.log("   All cleared receipted:", paymentsWithReceipt.length === clearedPayments.length);

  console.log("");
  console.log("Summary: Cash receipting", cashReceiptOk ? "PASS" : "FAIL", "| PayNow receipting", paynowReceiptOk ? "PASS" : "FAIL");
  process.exit(cashReceiptOk && paynowReceiptOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
