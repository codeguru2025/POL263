import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, getApiBase } from "@/lib/queryClient";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { CardSection } from "@/components/ds";
import { FileText, Eye, Download, Printer, Share2, Plus, Loader2, Trash2 } from "lucide-react";

function readEstatementDateRange() {
  const from = (document.getElementById("estatement-dateFrom") as HTMLInputElement | null)?.value;
  const to = (document.getElementById("estatement-dateTo") as HTMLInputElement | null)?.value;
  return { from, to };
}

interface DocumentsTabProps {
  selectedPolicy: any;
  displayPolicy: any;
  canWritePolicy: boolean;
  staffEstatementUrl: (policyId: string, download?: boolean, dateFrom?: string, dateTo?: string) => string;
  onOpenEstatementViewer: (url: string) => void;
}

export function DocumentsTab({ selectedPolicy, displayPolicy, canWritePolicy, staffEstatementUrl, onOpenEstatementViewer }: DocumentsTabProps) {
  const { toast } = useToast();

  const { data: policyDocs = [], refetch: refetchPolicyDocs } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "documents"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/documents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [docUploadType, setDocUploadType] = useState("other");
  const [docUploadLabel, setDocUploadLabel] = useState("");
  const [docUploading, setDocUploading] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  async function uploadPolicyDoc(file: File) {
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", docUploadType);
      fd.append("label", docUploadLabel || file.name);
      const res = await apiFetch(`/api/policies/${selectedPolicy!.id}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      refetchPolicyDocs();
      setDocUploadLabel("");
      toast({ title: "Document uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setDocUploading(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  }

  async function deletePolicyDoc(docId: string) {
    const res = await apiFetch(`/api/policies/${selectedPolicy!.id}/documents/${docId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      return;
    }
    refetchPolicyDocs();
    toast({ title: "Document deleted" });
  }

  return (
    <>
      <CardSection title="E-Statement" description="Open the preview to review your statement, then download from there if you need a file. Optionally filter by date range first." icon={FileText} contentClassName="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">From (optional)</Label>
              <Input
                type="date"
                id="estatement-dateFrom"
                className="w-36"
                data-testid="input-estatement-dateFrom"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">To (optional)</Label>
              <Input
                type="date"
                id="estatement-dateTo"
                className="w-36"
                data-testid="input-estatement-dateTo"
              />
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                const { from, to } = readEstatementDateRange();
                onOpenEstatementViewer(staffEstatementUrl(selectedPolicy.id, false, from, to));
              }}
              data-testid="btn-view-estatement"
            >
              <Eye className="h-4 w-4" /> View
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                const { from, to } = readEstatementDateRange();
                printDocument(staffEstatementUrl(selectedPolicy.id, false, from, to));
              }}
              data-testid="btn-print-estatement"
            >
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                const { from, to } = readEstatementDateRange();
                shareDocument(staffEstatementUrl(selectedPolicy.id, false, from, to), `E-Statement-${displayPolicy.policyNumber}`);
              }}
            >
              <Share2 className="h-4 w-4" /> Share
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Leave dates empty for full payment history. Uses tenant logo and signature from Settings.</p>
      </CardSection>

      <CardSection title="Policy Documents" description="Upload and manage documents for this policy (PDF, images, Word, audio, video — max 10MB each)." icon={FileText} contentClassName="space-y-4">
        {canWritePolicy && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="doc-upload-type">Document type</Label>
              <Select value={docUploadType} onValueChange={setDocUploadType}>
                <SelectTrigger id="doc-upload-type" className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="other">General</SelectItem>
                  <SelectItem value="id_copy">ID Copy</SelectItem>
                  <SelectItem value="policy_schedule">Policy Schedule</SelectItem>
                  <SelectItem value="payment_proof">Payment Proof</SelectItem>
                  <SelectItem value="claim_support">Claim Support</SelectItem>
                  <SelectItem value="medical">Medical</SelectItem>
                  <SelectItem value="waiver_support">Waiver Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="doc-upload-label">Label (optional)</Label>
              <Input id="doc-upload-label" className="w-48 h-9" placeholder="e.g. ID copy front" value={docUploadLabel} onChange={(e) => setDocUploadLabel(e.target.value)} />
            </div>
            <Button variant="outline" className="gap-2 h-9" disabled={docUploading} onClick={() => docFileInputRef.current?.click()}>
              {docUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Upload file
            </Button>
            <input ref={docFileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.mp3,.mp4,.wav,.m4a,.ogg,.avi,.mov" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPolicyDoc(f); }} />
          </div>
        )}
        {policyDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-md border">
            {policyDocs.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{doc.label || doc.fileName}</p>
                  <p className="text-xs text-muted-foreground">{doc.documentType} · {doc.mimeType} · {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : ""}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Open document" aria-label="Open document"><Eye className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  </a>
                  <a href={doc.fileUrl} download={doc.fileName}>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Download" aria-label="Download document"><Download className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  </a>
                  {canWritePolicy && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" aria-label="Delete document" onClick={() => deletePolicyDoc(doc.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardSection>
    </>
  );
}
