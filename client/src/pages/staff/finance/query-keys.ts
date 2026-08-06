// Named query-key constants for every query invalidated somewhere across the finance/
// folder. Centralizing these means an invalidation call in one tab file and the
// matching useQuery in another can never silently drift out of sync on the literal
// string array — see the finance.tsx -> finance/ split for the full invalidation audit.

export const QK_BANK_ACCOUNTS = ["/api/bank-accounts"];
export const QK_SAFES = ["/api/safes"];
export const QK_BANK_DEPOSITS = ["/api/bank-deposits"];
export const QK_CASH_POSITION = ["/api/cash-position"];
export const QK_BANK_STATEMENT_BALANCES = ["/api/bank-statement-balances"];
export const QK_REQUISITIONS = ["/api/requisitions"];
export const QK_APPROVALS = ["/api/approvals"];
export const QK_PAYMENT_DISBURSEMENTS = ["/api/payment-disbursements"];
export const QK_EXPENDITURES = ["/api/expenditures"];
export const QK_FX_RATES = ["/api/fx-rates"];
export const QK_PAYMENTS = ["/api/payments"];
export const QK_PAYMENT_INTENTS = ["/api/payment-intents"];
export const QK_CASHUPS = ["/api/cashups"];
export const QK_SETTLEMENTS = ["/api/settlements"];
export const QK_PLATFORM_SUMMARY = ["/api/platform/summary"];
export const QK_PLATFORM_RECEIVABLES = ["/api/platform/receivables"];
export const QK_PENDING_APPROVALS = ["/api/payment-receipts/pending-approvals"];
