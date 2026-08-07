import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardSection } from "@/components/ds";
import { CreditCard } from "lucide-react";

interface FinancialsTabProps {
  displayPolicy: any;
  clientPaymentMethods: any[] | undefined;
  onOpenPaymentMethodDialog: () => void;
}

export function FinancialsTab({ displayPolicy, clientPaymentMethods, onOpenPaymentMethodDialog }: FinancialsTabProps) {
  return (
    <>
      <CardSection title="Financial position" description="Premium schedule, balance, and cumulative receipts." icon={CreditCard}>
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Premium</p>
                <p className="text-lg font-bold tabular-nums" data-testid="text-premium-amount">{displayPolicy.currency} {Number(displayPolicy.premiumAmount).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground capitalize">{displayPolicy.paymentSchedule}</p>
              </div>
              {displayPolicy.balance != null && (
                <div>
                  <p className="text-muted-foreground text-xs">Balance</p>
                  <p className={`text-lg font-bold tabular-nums ${Number(displayPolicy.balance) > 0 ? "text-emerald-600" : Number(displayPolicy.balance) < 0 ? "text-destructive" : ""}`} data-testid="text-balance">
                    {displayPolicy.currency} {Number(displayPolicy.balance).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Number(displayPolicy.balance) > 0 ? "Advance" : Number(displayPolicy.balance) < 0 ? "Arrears" : "Up to date"}
                  </p>
                </div>
              )}
              {displayPolicy.totalPaid != null && (
                <div>
                  <p className="text-muted-foreground text-xs">Total paid</p>
                  <p className="text-lg font-bold tabular-nums">{displayPolicy.currency} {Number(displayPolicy.totalPaid).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">{displayPolicy.periodsElapsed ?? 0} period{(displayPolicy.periodsElapsed ?? 0) !== 1 ? "s" : ""} elapsed</p>
                </div>
              )}
              {displayPolicy.walletBalance != null && Math.abs(Number(displayPolicy.walletBalance)) >= 0.01 && (
                <div>
                  <p className="text-muted-foreground text-xs">Credit wallet</p>
                  <p className={`text-lg font-bold tabular-nums ${Number(displayPolicy.walletBalance) >= 0 ? "text-emerald-600" : "text-destructive"}`} data-testid="text-wallet-balance">
                    {displayPolicy.currency} {Number(displayPolicy.walletBalance).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">{Number(displayPolicy.walletBalance) >= 0 ? "Credit / advance" : "Owed (arrears)"}</p>
                </div>
              )}
            </div>
          </div>
      </CardSection>

      <CardSection
        title="Automatic mobile payments"
        icon={CreditCard}
        headerRight={(
          <Button variant="outline" size="sm" onClick={onOpenPaymentMethodDialog} data-testid="btn-edit-payment-method">
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        )}
      >
          {(() => {
            const current = (clientPaymentMethods || []).find((m: any) => m.isDefault && m.isActive) || (clientPaymentMethods || [])[0];
            if (!current) return <p className="text-sm text-muted-foreground">No saved mobile wallet. Add one to enable automatic collection reminders (the client confirms with their PIN on their phone).</p>;
            if (current.methodType === "card") {
              return (
                <div className="text-sm space-y-1">
                  <p className="text-muted-foreground">Legacy card on file is not used for recurring collection.</p>
                  <p className="font-medium">Replace with EcoCash / OneMoney / InnBucks / O&apos;Mari + mobile number.</p>
                </div>
              );
            }
            return <p className="text-sm">{(current.provider || "mobile").toUpperCase()} · {current.mobileNumber || "—"}</p>;
          })()}
      </CardSection>
    </>
  );
}
