/**
 * Client policy document viewer: show PDF inline in the app.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft } from "lucide-react";

export default function ClientDocumentView() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/client/documents/view/:policyId");
  const policyId = params?.policyId;

  const { data: me } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies } = useQuery<{ id: string; policyNumber: string }[]>({
    queryKey: ["/api/client-auth/policies"],
    enabled: !!me?.client && !!policyId,
  });

  const policy = policies?.find((p) => p.id === policyId);
  const base = getApiBase();
  const documentUrl = policyId ? `${base}/api/client-auth/policies/${policyId}/document?inline=1` : "";

  if (!policyId || !me?.client) {
    return (
      <ClientLayout clientName="">
        <div className="max-w-2xl mx-auto space-y-6">
          <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client/documents")}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center py-8">Invalid or missing policy. Go back to documents.</p>
            </CardContent>
          </Card>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout clientName="">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" className="gap-2 shrink-0" onClick={() => setLocation("/client/documents")}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
          {policy && (
            <CardTitle className="flex items-center gap-2 text-lg font-medium">
              <FileText className="h-5 w-5 text-primary" />
              Policy document — {policy.policyNumber}
            </CardTitle>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            <iframe
              title={`Policy document ${policy?.policyNumber ?? policyId}`}
              src={documentUrl}
              className="w-full min-h-[80vh] border-0 rounded-b-lg"
            />
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}
