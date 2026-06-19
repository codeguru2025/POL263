import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";
import { Users, Search, ExternalLink } from "lucide-react";
import { useState, useDeferredValue } from "react";

interface Agent {
  id: string;
  displayName: string;
  email: string;
  referralCode?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
}

interface CommissionSummary {
  agentId: string;
  agentName: string;
  total: string;
  netPay: string;
  clawback: string;
  numberOfPolicies: number;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function StaffAgentsAdmin() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data: allAgents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: commissions = [] } = useQuery<CommissionSummary[]>({ queryKey: ["/api/reports/commissions-summary"] });

  const commissionByAgent = Object.fromEntries(commissions.map((c) => [c.agentId, c]));

  const agents = deferredSearch
    ? allAgents.filter((a) => {
        const q = deferredSearch.toLowerCase();
        return (
          a.displayName?.toLowerCase().includes(q) ||
          a.email?.toLowerCase().includes(q) ||
          a.referralCode?.toLowerCase().includes(q)
        );
      })
    : allAgents;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">Agents</span>}
          description="Sales agents registered on this platform. Click an agent to view their policy portfolio."
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link href="/staff/users">Manage user accounts</Link>
            </Button>
          }
        />

        <div className="flex items-center gap-2 max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search by name, email, or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>

        <CardSection title={`Agents (${agents.length})`} icon={Users} contentClassName="p-0">
          {agents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {deferredSearch ? `No agents match "${deferredSearch}"` : "No agents found. Assign the Agent role to a user account."}
            </p>
          ) : (
            <ul className="divide-y">
              {agents.map((a) => {
                const comm = commissionByAgent[a.id];
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs">{initials(a.displayName || a.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{a.displayName || a.email}</span>
                        {a.referralCode && (
                          <Badge variant="outline" className="text-xs shrink-0">{a.referralCode}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{a.email}</p>
                      {comm && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {comm.numberOfPolicies} {comm.numberOfPolicies === 1 ? "policy" : "policies"} · commission earned: <span className="text-foreground font-medium">{Number(comm.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          {Number(comm.clawback) !== 0 && <> · clawback: <span className="text-destructive font-medium">{Number(comm.clawback).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></>}
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                      <Link href={`/staff/users`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
