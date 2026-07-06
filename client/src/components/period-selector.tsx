import { useState } from "react";
import { format, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DateRange } from "react-day-picker";

export type PeriodPreset = "today" | "week" | "mtd" | "ytd" | "custom";

export interface Period {
  preset: PeriodPreset;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/** Computes the {from, to} range for a given preset, anchored on today. */
export function periodForPreset(preset: PeriodPreset, custom?: { from: string; to: string }): Period {
  const today = new Date();
  const todayStr = fmt(today);
  switch (preset) {
    case "week":
      return { preset, from: fmt(startOfWeek(today, { weekStartsOn: 1 })), to: todayStr };
    case "mtd":
      return { preset, from: fmt(startOfMonth(today)), to: todayStr };
    case "ytd":
      return { preset, from: fmt(startOfYear(today)), to: todayStr };
    case "custom":
      return { preset, from: custom?.from ?? todayStr, to: custom?.to ?? todayStr };
    case "today":
    default:
      return { preset: "today", from: todayStr, to: todayStr };
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Today",
  week: "This week",
  mtd: "Month to date",
  ytd: "Year to date",
  custom: "Custom range",
};

/**
 * Standard period selector for dashboards/reports. Defaults callers to "today"
 * unless they pass a different initial value. Emits {preset, from, to} — from/to
 * are always populated (YYYY-MM-DD) regardless of preset, so callers can just
 * use them directly as query params.
 */
export function PeriodSelector({ value, onChange, className }: {
  value: Period;
  onChange: (period: Period) => void;
  className?: string;
}) {
  const [customRange, setCustomRange] = useState<DateRange | undefined>(
    value.preset === "custom" ? { from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") } : undefined
  );
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handlePresetChange = (preset: string) => {
    if (preset === "custom") {
      setPopoverOpen(true);
      onChange(periodForPreset("custom", customRange?.from && customRange?.to
        ? { from: fmt(customRange.from), to: fmt(customRange.to) }
        : undefined));
    } else {
      onChange(periodForPreset(preset as PeriodPreset));
    }
  };

  const handleCustomRangeSelect = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (range?.from && range?.to) {
      onChange({ preset: "custom", from: fmt(range.from), to: fmt(range.to) });
      setPopoverOpen(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Select value={value.preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-40" data-testid="select-period-preset">
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => (
            <SelectItem key={p} value={p}>{PRESET_LABELS[p]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.preset === "custom" && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-custom-range">
              <CalendarIcon className="h-3.5 w-3.5" />
              {value.from === value.to ? value.from : `${value.from} – ${value.to}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={handleCustomRangeSelect}
              numberOfMonths={2}
              defaultMonth={customRange?.from}
            />
          </PopoverContent>
        </Popover>
      )}

      {value.preset !== "custom" && (
        <span className="text-xs text-muted-foreground">{value.from === value.to ? value.from : `${value.from} → ${value.to}`}</span>
      )}
    </div>
  );
}
