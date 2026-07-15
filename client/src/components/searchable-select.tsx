import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableOption {
  value: string;
  label: string;
  /** Extra text searched against but shown muted (e.g. phone number). */
  hint?: string;
}

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Label shown for the cleared/none state. */
  noneLabel?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * A type-to-filter combobox built on Command + Popover. Drop-in replacement for
 * a plain Select when the option list is long (fleet vehicles, staff drivers).
 * Selecting the noneLabel row clears the value (passes "").
 */
export function SearchableSelect({
  options, value, onChange, placeholder = "Select…",
  searchPlaceholder = "Search…", emptyText = "No match found.",
  noneLabel = "— None —", className, ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const listboxId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
          data-testid={rest["data-testid"]}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent id={listboxId} className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => { onChange(""); setOpen(false); }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">{noneLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""}`}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">
                    {o.label}
                    {o.hint && <span className="text-muted-foreground ml-1">· {o.hint}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
