import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getApiBase } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Search, Plus, FileStack, Users, Receipt, FileText, Target, Wallet2,
  LayoutDashboard, ShieldCheck, Truck, ChevronDown,
} from "lucide-react";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

type ActionDef = {
  label: string;
  icon: typeof FileStack;
  href: string;
  perms?: string[]; // any-of; empty/undefined = always
  group: "Create" | "Go to";
};

const ACTIONS: ActionDef[] = [
  // Create
  { label: "New Lead", icon: Target, href: "/staff/leads?create=1", perms: ["write:lead"], group: "Create" },
  { label: "New Client", icon: Users, href: "/staff/clients?create=1", perms: ["write:client"], group: "Create" },
  { label: "New Policy", icon: FileStack, href: "/staff/policies?create=1", perms: ["write:policy"], group: "Create" },
  { label: "New Claim", icon: FileText, href: "/staff/claims?create=1", perms: ["write:claim"], group: "Create" },
  { label: "Receipt a Payment", icon: Receipt, href: "/staff/finance?tab=payments", perms: ["write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer"], group: "Create" },
  { label: "Start Cash-up", icon: Wallet2, href: "/staff/finance?tab=cashups", perms: ["read:finance", "read:commission"], group: "Create" },
  // Go to
  { label: "Home", icon: LayoutDashboard, href: "/staff", group: "Go to" },
  { label: "Policies", icon: FileStack, href: "/staff/policies", perms: ["read:policy"], group: "Go to" },
  { label: "Clients", icon: Users, href: "/staff/clients", perms: ["read:client"], group: "Go to" },
  { label: "Claims", icon: FileText, href: "/staff/claims", perms: ["read:claim"], group: "Go to" },
  { label: "Funeral Cases", icon: Truck, href: "/staff/funerals", perms: ["read:funeral_ops"], group: "Go to" },
  { label: "Collections", icon: Receipt, href: "/staff/finance?tab=payments", perms: ["read:finance", "read:commission"], group: "Go to" },
  { label: "Approvals", icon: ShieldCheck, href: "/staff/approvals", perms: ["manage:approvals"], group: "Go to" },
];

interface PolicyHit { id: string; policyNumber: string; status?: string }
interface ClientHit { id: string; firstName?: string; lastName?: string; phone?: string; name?: string }

function useAllowedActions() {
  const { permissions } = useAuth();
  const allowed = useCallback(
    (perms?: string[]) => !perms || perms.length === 0 || perms.some((p) => permissions.includes(p)),
    [permissions],
  );
  return ACTIONS.filter((a) => allowed(a.perms));
}

/** Shared palette dialog (Ctrl-K). */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [, setLocation] = useLocation();
  const { permissions } = useAuth();
  const actions = useAllowedActions();
  const [query, setQuery] = useState("");
  const [policies, setPolicies] = useState<PolicyHit[]>([]);
  const [clients, setClients] = useState<ClientHit[]>([]);
  const seq = useRef(0);

  const canReadPolicy = permissions.includes("read:policy");
  const canReadClient = permissions.includes("read:client");

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setPolicies([]);
      setClients([]);
      return;
    }
    const t = setTimeout(async () => {
      const mySeq = ++seq.current;
      const base = getApiBase();
      const fetchJson = async (url: string) => {
        try {
          const res = await fetch(base + url, { credentials: "include" });
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      };
      const [pol, cli] = await Promise.all([
        canReadPolicy ? fetchJson(`/api/policies?q=${encodeURIComponent(q)}&limit=8`) : Promise.resolve([]),
        canReadClient ? fetchJson(`/api/clients?q=${encodeURIComponent(q)}&limit=8`) : Promise.resolve([]),
      ]);
      if (mySeq !== seq.current) return;
      setPolicies(pol);
      setClients(cli);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, canReadPolicy, canReadClient]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    setLocation(href);
  };

  const matchesQuery = (label: string) => !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase());
  const createActions = actions.filter((a) => a.group === "Create" && matchesQuery(a.label));
  const navActions = actions.filter((a) => a.group === "Go to" && matchesQuery(a.label));
  const clientName = (c: ClientHit) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.phone || "Client";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* shouldFilter=false: static actions are filtered manually; entity hits come from the server */}
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search policies, clients… or type a command" />
        <CommandList>
          <CommandEmpty>No results. Try a policy number, client name, or phone.</CommandEmpty>

          {policies.length > 0 && (
            <CommandGroup heading="Policies">
              {policies.map((p) => (
                <CommandItem key={p.id} value={`policy-${p.id}`} onSelect={() => go(`/staff/policies?openPolicy=${encodeURIComponent(p.id)}`)}>
                  <FileStack className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{p.policyNumber}</span>
                  {p.status && <span className="ml-auto text-xs text-muted-foreground capitalize">{p.status}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {clients.length > 0 && (
            <CommandGroup heading="Clients">
              {clients.map((c) => (
                <CommandItem key={c.id} value={`client-${c.id}`} onSelect={() => go(`/staff/clients?openClient=${encodeURIComponent(c.id)}`)}>
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{clientName(c)}</span>
                  {c.phone && <span className="ml-auto text-xs text-muted-foreground">{c.phone}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {createActions.length > 0 && (
            <CommandGroup heading="Create">
              {createActions.map((a) => (
                <CommandItem key={a.label} value={a.label} onSelect={() => go(a.href)}>
                  <a.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {navActions.length > 0 && (
            <CommandGroup heading="Go to">
              {navActions.map((a) => (
                <CommandItem key={a.label} value={`nav-${a.label}`} onSelect={() => go(a.href)}>
                  <a.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** Header search trigger that also owns the Ctrl-K shortcut. */
export function GlobalCommandBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-muted-foreground text-sm hover:bg-muted/50 transition-colors w-full max-w-md"
        data-testid="global-command-trigger"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search policies, clients…</span>
        <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Persistent context-aware "+ New" button. */
export function QuickCreateMenu() {
  const [, setLocation] = useLocation();
  const actions = useAllowedActions().filter((a) => a.group === "Create");
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5" data-testid="quick-create-trigger">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} className="gap-2 cursor-pointer" onClick={() => setLocation(a.href)}>
            <a.icon className="h-4 w-4 text-muted-foreground" />
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
