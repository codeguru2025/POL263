import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_CONFIG, normalizeEnabledCurrencies, type SupportedCurrency } from "@shared/validation";
import { useAuth } from "@/hooks/use-auth";
import { useBranding } from "@/hooks/use-branding";

interface CurrencySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Every currency picker in the app renders through here, so it's the single place that needs to
 * know about org.enabledCurrencies rather than each of the ~10 call sites (policy creation,
 * payments, pricebook, payroll, etc.) needing its own change. Reads the current org's enabled
 * subset via useBranding() (which already carries it — see client/src/hooks/use-branding.ts) and
 * falls back to the default 3-item list (normalizeEnabledCurrencies's own fallback) if unset, so an
 * org can never end up with zero selectable currencies.
 */
export function CurrencySelect({ value, onValueChange, disabled, className }: CurrencySelectProps) {
  const { user } = useAuth();
  const orgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const { branding } = useBranding(orgId);
  const enabledCurrencies = normalizeEnabledCurrencies(branding.enabledCurrencies);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {enabledCurrencies.map((code) => (
          <SelectItem key={code} value={code}>
            {code} ({CURRENCY_CONFIG[code as SupportedCurrency].symbol})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
