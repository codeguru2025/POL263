import { CardSection } from "@/components/ds";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";
import { useFlag, setFlag, type FlagName } from "@/lib/flags";

const FLAG_META: { name: FlagName; label: string; description: string }[] = [
  { name: "newNav", label: "New navigation", description: "Job-based menus (Sales, Clients, Policies, Collections, Claims, Finance, Reports, Setup)." },
  { name: "globalSearch", label: "Global search bar", description: "Header search across policies & clients (replaces the policy-only search)." },
  { name: "commandPalette", label: "Command palette (⌘K)", description: "Keyboard launcher for search and quick actions, available everywhere." },
  { name: "quickCreate", label: "Quick create button", description: 'The "+ New" button in the header for fast record creation.' },
  { name: "commandCenters", label: "Role command centers", description: "Replaces the Home quick-access card with role-based work queues." },
];

function FlagRow({ name, label, description }: { name: FlagName; label: string; description: string }) {
  const value = useFlag(name);
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <div className="space-y-0.5">
        <Label htmlFor={`flag-${name}`} className="font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={`flag-${name}`}
        checked={value}
        onCheckedChange={(v) => setFlag(name, v)}
        data-testid={`flag-toggle-${name}`}
      />
    </div>
  );
}

/**
 * In-product control for the UX transformation feature flags (Part H of the
 * transformation plan). Toggles are stored per-browser in localStorage and take
 * effect immediately — the operational kill-switch / opt-in for the new experience.
 */
export function FeatureFlagsCard() {
  return (
    <CardSection
      title="Experience (beta features)"
      description="Turn the redesigned navigation and tools on or off. Changes apply instantly to this browser only."
      icon={Sparkles}
      className="max-w-2xl"
    >
      <div className="divide-y">
        {FLAG_META.map((f) => (
          <FlagRow key={f.name} {...f} />
        ))}
      </div>
    </CardSection>
  );
}
