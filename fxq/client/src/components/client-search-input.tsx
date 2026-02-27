import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { getApiBase } from "@/lib/queryClient";
import { Search, Loader2 } from "lucide-react";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  nationalId?: string | null;
}

export function ClientSearchInput({
  value,
  onChange,
  placeholder = "Search clients by name, email, or phone...",
  disabled,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (clientId: string, client: ClientOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [results, setResults] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // When value is cleared externally, clear label
  useEffect(() => {
    if (!value) setSelectedLabel("");
  }, [value]);

  useEffect(() => {
    if (!query.trim() || query.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          getApiBase() + `/api/clients?q=${encodeURIComponent(query.trim())}&limit=20`,
          { credentials: "include" }
        );
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayValue = value ? selectedLabel || query : query;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          data-testid={dataTestId}
          className="pl-9"
          placeholder={placeholder}
          value={value ? displayValue : query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) {
              onChange("", null);
              setSelectedLabel("");
            } else setOpen(true);
          }}
          onFocus={() => query.length >= MIN_CHARS && results.length > 0 && setOpen(true)}
          disabled={disabled}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {open && query.length >= MIN_CHARS && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover py-1 shadow-lg max-h-60 overflow-auto">
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No clients found</li>
          ) : (
            results.map((c) => {
              const parts = [c.email, c.phone, c.nationalId].filter(Boolean) as string[];
              const sub = parts.length ? ` · ${parts.join(" · ")}` : "";
              return (
              <li
                key={c.id}
                className="cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onChange(c.id, c);
                  setSelectedLabel(`${c.firstName} ${c.lastName}`);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="font-medium">{c.firstName} {c.lastName}</span>
                {sub && <span className="text-muted-foreground ml-2 text-xs">{sub}</span>}
              </li>
              );
            })
          )}
        </ul>
      )}
      {query.length > 0 && query.length < MIN_CHARS && (
        <p className="text-xs text-muted-foreground mt-1">Type at least {MIN_CHARS} characters to search</p>
      )}
    </div>
  );
}
