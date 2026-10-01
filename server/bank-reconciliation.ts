/**
 * Reports → Finance → Bank Reconciliation. Pure — no DB.
 *
 * For each bank account over a period:
 *   opening statement balance (last statement BEFORE the period)
 *   + cash deposited into the account
 *   + money received through the bank (EcoCash/OneMoney/InnBucks/PayNow/card/bank transfer —
 *     anything not paid in cash)
 *   − money paid out through the bank (any payout method other than cash)
 *   = what the bank should show
 * compared with the closing statement balance (last statement on or before the end of the
 * period, and not before it starts). The difference is what finance has to explain — bank
 * charges, interest, or something not recorded.
 *
 * Receipts and payouts aren't linked to a specific account. When a currency has exactly one
 * active account they're attributed to it; with several, they're reported per currency as
 * "not linked to an account" rather than guessed.
 */
import { toCents, fromCents } from "@shared/money";

/** Ways of paying that don't touch the bank. */
export const NON_BANK_METHODS = new Set(["cash", "credit_balance", "petty_cash"]);
export function goesThroughBank(method: string | null | undefined): boolean {
  return !NON_BANK_METHODS.has(String(method ?? "cash").toLowerCase());
}

export interface StatementPoint { date: string; balance: string | number }

export interface AccountInput {
  accountName: string;
  bankName: string | null;
  currency: string;
  /** Statement closing balances, any order. */
  statements: StatementPoint[];
  deposits: string | number;
  depositCount: number;
}

export type ReconStatus = "agrees" | "difference" | "no_opening" | "no_closing";

export interface AccountReconciliation {
  accountName: string;
  bankName: string | null;
  currency: string;
  openingBalance: string | null;
  openingDate: string | null;
  deposits: string;
  depositCount: number;
  receivedThroughBank: string;
  paidThroughBank: string;
  expectedClosing: string | null;
  closingBalance: string | null;
  closingDate: string | null;
  difference: string | null;
  status: ReconStatus;
}

export interface CurrencyFlows { received: string | number; paid: string | number; receivedCount: number; paidCount: number }

export function reconcileBankAccounts(
  accounts: AccountInput[],
  flowsByCurrency: Record<string, CurrencyFlows>,
  from: string,
  to: string,
): { accounts: AccountReconciliation[]; unlinked: Record<string, CurrencyFlows> } {
  const perCurrency = new Map<string, number>();
  for (const a of accounts) perCurrency.set(a.currency, (perCurrency.get(a.currency) ?? 0) + 1);

  const out: AccountReconciliation[] = accounts.map((a) => {
    const sorted = [...a.statements].map((s) => ({ date: String(s.date).slice(0, 10), balance: s.balance })).sort((x, y) => (x.date < y.date ? -1 : 1));
    const opening = [...sorted].reverse().find((s) => s.date < from) ?? null;
    const closing = [...sorted].reverse().find((s) => s.date <= to && s.date >= from) ?? null;
    const flows = perCurrency.get(a.currency) === 1 ? flowsByCurrency[a.currency] : undefined;
    const receivedC = toCents(flows?.received ?? 0);
    const paidC = toCents(flows?.paid ?? 0);
    const depositsC = toCents(a.deposits);
    const expectedC = opening ? toCents(opening.balance) + depositsC + receivedC - paidC : null;
    const diffC = expectedC != null && closing ? toCents(closing.balance) - expectedC : null;
    const status: ReconStatus = !opening ? "no_opening" : !closing ? "no_closing" : diffC === 0 ? "agrees" : "difference";
    return {
      accountName: a.accountName, bankName: a.bankName, currency: a.currency,
      openingBalance: opening ? fromCents(toCents(opening.balance)) : null, openingDate: opening?.date ?? null,
      deposits: fromCents(depositsC), depositCount: a.depositCount,
      receivedThroughBank: fromCents(receivedC), paidThroughBank: fromCents(paidC),
      expectedClosing: expectedC != null ? fromCents(expectedC) : null,
      closingBalance: closing ? fromCents(toCents(closing.balance)) : null, closingDate: closing?.date ?? null,
      difference: diffC != null ? fromCents(diffC) : null,
      status,
    };
  });

  const unlinked: Record<string, CurrencyFlows> = {};
  for (const [c, f] of Object.entries(flowsByCurrency)) {
    if (perCurrency.get(c) === 1) continue;
    if (toCents(f.received) === 0 && toCents(f.paid) === 0) continue;
    unlinked[c] = f;
  }
  return { accounts: out, unlinked };
}
