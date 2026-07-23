import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CountryFlagSettings {
  organizationId: string;
  isEnabled: boolean;
  flagLabel: string;
  homeLabel: string;
  updatedAt: string;
}

/**
 * Tenant-configurable cross-border flag: a checkbox + optional reference number,
 * shown only when the org has enabled it (via Settings > Country Flag) and
 * labeled with the org's own configured country names. Generalizes what used to
 * be a hardcoded "South Africa" checkbox on policies.
 */
export function CountryFlagFields({
  settings,
  idPrefix,
  checked,
  reference,
  onCheckedChange,
  onReferenceChange,
}: {
  settings: CountryFlagSettings | undefined;
  idPrefix: string;
  checked: boolean;
  reference: string;
  onCheckedChange: (checked: boolean) => void;
  onReferenceChange: (value: string) => void;
}) {
  if (!settings?.isEnabled) return null;
  const checkboxId = `${idPrefix}-country-flag`;
  return (
    <>
      <div className="flex items-start gap-3 border rounded-md p-3">
        <Checkbox
          id={checkboxId}
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(!!v)}
          data-testid={`checkbox-${idPrefix}-country-flag`}
        />
        <div className="space-y-1 leading-none">
          <label htmlFor={checkboxId} className="text-sm font-medium cursor-pointer">
            {settings.flagLabel}-based
          </label>
          <p className="text-xs text-muted-foreground">
            Leave unchecked for {settings.homeLabel}-based records.
          </p>
        </div>
      </div>
      {checked && (
        <div>
          <Label htmlFor="reference">{settings.flagLabel} Reference Number</Label>
          <Input id="reference"
            value={reference}
            onChange={(e) => onReferenceChange(e.target.value)}
            placeholder={`e.g. the ${settings.flagLabel} branch's own reference number`}
            data-testid={`input-${idPrefix}-country-reference`}
          />
        </div>
      )}
    </>
  );
}
