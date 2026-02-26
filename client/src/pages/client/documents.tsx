/**
 * Client documents page: list policies and download policy document PDF per policy.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft, Download } from "lucide-react";

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
}

export default function ClientDocuments() {
  const [, setLocation] = useLocation();
  const { data: me } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies, isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/client-auth/policies"],
    enabled: !!me?.client,
  });

  const base = getApiBase();

  return (
    <ClientLayout clientName="">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client")}>
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Policy documents
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Download your policy certificate (policy document) for each policy below.
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-6 text-center">Loading…</p>
            ) : !policies || policies.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">No policies found.</p>
            ) : (
              <ul className="space-y-3">
                {policies.map((p) => (
                  <li key={p.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{p.policyNumber}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.status.replace(/_/g, " ")} — {p.currency} {p.premiumAmount}</p>
                    </div>
                    <a
                      href={`${base}/api/client-auth/policies/${p.id}/document`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Download className="h-4 w-4" />
                      Download policy document
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}
