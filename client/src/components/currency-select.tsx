import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_CURRENCIES, CURRENCY_CONFIG, type SupportedCurrency } from "@shared/validation";

interface CurrencySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CurrencySelect({ value, onValueChange, disabled, className }: CurrencySelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_CURRENCIES.map((code) => (
          <SelectItem key={code} value={code}>
            {code} ({CURRENCY_CONFIG[code as SupportedCurrency].symbol})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
