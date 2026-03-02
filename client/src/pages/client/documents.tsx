/**
 * Client documents page: list policies and view or download policy document PDF per policy.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft, Download, Eye, Printer } from "lucide-react";
import { printDocument } from "@/lib/print-document";

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
}

export default function ClientDocuments() {
  const [, setLocation] = useLocation();
  const { data: me, isFetched: meFetched, isError: meError } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies, isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/client-auth/policies"],
    enabled: !!me?.client,
  });

  const base = getApiBase();

  if (meFetched && (meError || !me?.client)) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Please sign in again to access your portal.</p>
            <Button onClick={() => setLocation("/client/login")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
              View or download your policy certificate (policy document) for each policy below.
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
                  <li key={p.id} className="flex items-center justify-between gap-4 p-4 border rounded-lg flex-wrap">
                    <div>
                      <p className="font-medium text-sm">{p.policyNumber}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.status.replace(/_/g, " ")} — {p.currency} {p.premiumAmount}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/client/documents/view/${p.id}`}>
                        <Button variant="outline" size="sm" className="gap-2">
                          <Eye className="h-4 w-4" />
                          View
                        </Button>
                      </Link>
                      <a
                        href={`${base}/api/client-auth/policies/${p.id}/document`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() => printDocument(`${base}/api/client-auth/policies/${p.id}/document`)}
                      >
                        <Printer className="h-4 w-4" />
                        Print
                      </Button>
                    </div>
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
