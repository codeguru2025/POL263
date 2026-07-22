import { useState, useEffect, useRef, useId } from "react";
import { Input } from "@/components/ui/input";
import { getApiBase } from "@/lib/queryClient";
import { Search, Loader2 } from "lucide-react";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

interface PolicyOption {
  id: string;
  policyNumber: string;
  clientId: string;
  status?: string;
}

export function PolicySearchInput({
  value,
  onChange,
  placeholder = "Search by policy number or client name...",
  disabled,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (policyId: string, policy: PolicyOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedPolicyNumber, setSelectedPolicyNumber] = useState<string>("");
  const [results, setResults] = useState<PolicyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const listboxId = useId();
  const getOptionId = (id: string) => `${listboxId}-opt-${id}`;

  useEffect(() => {
    if (!value) setSelectedPolicyNumber("");
  }, [value]);

  useEffect(() => {
    if (!query.trim() || query.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      const seq = ++searchSeq.current;
      setLoading(true);
      try {
        const res = await fetch(
          getApiBase() + `/api/policies?q=${encodeURIComponent(query.trim())}&limit=20`,
          { credentials: "include" }
        );
        if (seq !== searchSeq.current) return;
        if (!res.ok) {
          setResults([]);
          setOpen(true);
          return;
        }
        const data = await res.json();
        if (seq !== searchSeq.current) return;
        setResults(Array.isArray(data) ? data : []);
        setActiveIndex(-1);
        setOpen(true);
      } catch {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setOpen(true);
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setActiveIndex(-1); }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayValue = value ? selectedPolicyNumber || query : query;
  const showDropdown = open && query.length >= MIN_CHARS;

  const selectPolicy = (p: PolicyOption) => {
    onChange(p.id, p);
    setSelectedPolicyNumber(p.policyNumber);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        selectPolicy(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          data-testid={dataTestId}
          className="pl-9"
          placeholder={placeholder}
          value={value ? displayValue : query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) {
              onChange("", null);
              setSelectedPolicyNumber("");
            } else setOpen(true);
          }}
          onFocus={() => query.length >= MIN_CHARS && results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? getOptionId(results[activeIndex].id) : undefined}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>
      {showDropdown && (
        <ul id={listboxId} role="listbox" className="absolute z-50 mt-1 w-full rounded-md border bg-popover py-1 shadow-lg max-h-60 overflow-auto">
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No policies found</li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                id={getOptionId(p.id)}
                role="option"
                aria-selected={i === activeIndex}
                className={`cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between items-center ${i === activeIndex ? "bg-accent text-accent-foreground" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectPolicy(p)}
              >
                <span className="font-mono font-medium">{p.policyNumber}</span>
                {p.status && <span className="text-muted-foreground text-xs">{p.status}</span>}
              </li>
            ))
          )}
        </ul>
      )}
      {query.length > 0 && query.length < MIN_CHARS && (
        <p className="text-xs text-muted-foreground mt-1">Type at least {MIN_CHARS} characters to search</p>
      )}
    </div>
  );
}
