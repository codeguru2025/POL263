/**
 * Client policy document viewer: show PDF inline in the app.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft, Printer } from "lucide-react";
import { printDocument } from "@/lib/print-document";

export default function ClientDocumentView() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/client/documents/view/:policyId");
  const policyId = params?.policyId;

  const { data: me, isFetched: meFetched, isError: meError } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies } = useQuery<{ id: string; policyNumber: string }[]>({
    queryKey: ["/api/client-auth/policies"],
    enabled: !!me?.client && !!policyId,
  });

  const policy = policies?.find((p) => p.id === policyId);
  const base = getApiBase();
  const documentUrl = policyId ? `${base}/api/client-auth/policies/${policyId}/document` : "";

  if (meFetched && (meError || !me?.client)) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">Please sign in again to access your portal.</p>
          <Button onClick={() => setLocation("/client/login")}>Sign In</Button>
        </div>
      </div>
    );
  }

  if (!policyId || !me?.client) {
    return (
      <ClientLayout clientName="">
        <PageShell className="max-w-2xl mx-auto">
          <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client/documents")}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
          <CardSection title="Document not found" icon={FileText}>
            <p className="text-muted-foreground text-center py-8">Invalid or missing policy. Go back to documents.</p>
          </CardSection>
        </PageShell>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout clientName="">
      <PageShell className="max-w-4xl mx-auto gap-4">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" className="gap-2 shrink-0" onClick={() => setLocation("/client/documents")}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
          {policy && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => printDocument(documentUrl)}
              data-testid="btn-print-client-doc"
            >
              <Printer className="h-4 w-4" /> Print
            </Button>
          )}
        </div>
        <CardSection
          title={policy ? `Policy document — ${policy.policyNumber}` : "Policy document"}
          icon={FileText}
          flush
        >
          <iframe
            title={`Policy document ${policy?.policyNumber ?? policyId}`}
            src={documentUrl}
            className="w-full min-h-[80vh] border-0 rounded-b-xl"
          />
        </CardSection>
      </PageShell>
    </ClientLayout>
  );
}
