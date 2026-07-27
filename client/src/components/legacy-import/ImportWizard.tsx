import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, CheckCircle2, ArrowLeft, History, Eye, Undo2 } from "lucide-react";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  type: "text" | "date" | "number" | "enum";
}

interface UploadResult {
  uploadToken: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: Record<string, string>;
  fieldSpec: FieldSpec[];
}

interface RowError {
  rowIndex: number;
  field: string;
  message: string;
}

interface PreviewResult {
  batchId: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  sampleErrors: RowError[];
}

interface ImportBatchSummary {
  id: string;
  entityType: string;
  sourceSystemLabel: string | null;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  createdAt: string;
  committedAt: string | null;
  rollbackBlockedReason: string | null;
}

interface ProductVersionOption {
  id: string;
  version: number;
  productName?: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorEmail: string | null;
  timestamp: string;
}

// Extended as more entity types gain a field spec/commit path on the server.
const ENTITY_TYPE_OPTIONS = [
  { value: "client", label: "Clients / Members" },
  { value: "policy", label: "Policies" },
  { value: "payment", label: "Payments / Receipts" },
  { value: "claim", label: "Claims" },
];

type Step = "upload" | "map" | "valuemap" | "preview" | "done";
const USE_LEGACY_PLACEHOLDER = "__legacy_placeholder__";

export function ImportWizard({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const batchesKey = ["/api/platform/tenants", orgId, "import/batches"];

  const [step, setStep] = useState<Step>("upload");
  const [viewingAuditBatchId, setViewingAuditBatchId] = useState<string | null>(null);
  const [rollbackTargetId, setRollbackTargetId] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("client");
  const [sourceSystemLabel, setSourceSystemLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [planValues, setPlanValues] = useState<string[]>([]);
  const [planValueMapping, setPlanValueMapping] = useState<Record<string, string>>({});

  const { data: batches, isLoading: batchesLoading } = useQuery<ImportBatchSummary[]>({
    queryKey: batchesKey,
  });

  const { data: productVersions } = useQuery<ProductVersionOption[]>({
    queryKey: ["/api/platform/tenants", orgId, "import/product-versions"],
    enabled: step === "valuemap",
  });

  const { data: auditRows, isLoading: auditLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/platform/tenants", orgId, "import/batches", viewingAuditBatchId, "audit-log"],
    enabled: !!viewingAuditBatchId,
  });

  function resetWizard() {
    setStep("upload");
    setFile(null);
    setUploadResult(null);
    setColumnMapping({});
    setPreviewResult(null);
    setPlanValues([]);
    setPlanValueMapping({});
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + `/api/platform/tenants/${orgId}/import/upload`, {
        method: "POST", headers, body: formData, credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      return json as UploadResult;
    },
    onSuccess: (data) => {
      setUploadResult(data);
      setColumnMapping(data.suggestedMapping);
      setStep("map");
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const distinctValuesMutation = useMutation({
    mutationFn: async () => {
      if (!uploadResult) throw new Error("Upload a file first");
      const res = await apiRequest("POST", `/api/platform/tenants/${orgId}/import/distinct-values`, {
        uploadToken: uploadResult.uploadToken,
        column: columnMapping.planName,
      });
      return (await res.json()) as { values: string[] };
    },
    onSuccess: (data) => {
      setPlanValues(data.values);
      setStep("valuemap");
    },
    onError: (e: any) => toast({ title: "Could not load plan names", description: e.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!uploadResult) throw new Error("Upload a file first");
      const valueMappings = Object.keys(planValueMapping).length > 0 ? { planName: planValueMapping } : null;
      const res = await apiRequest("POST", `/api/platform/tenants/${orgId}/import/preview`, {
        uploadToken: uploadResult.uploadToken,
        entityType,
        columnMapping,
        valueMappings,
        sourceSystemLabel: sourceSystemLabel || null,
      });
      return (await res.json()) as PreviewResult;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setStep("preview");
    },
    onError: (e: any) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  function proceedFromMapping() {
    if (entityType === "policy" && columnMapping.planName) {
      distinctValuesMutation.mutate();
    } else {
      previewMutation.mutate();
    }
  }

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!previewResult) throw new Error("Preview first");
      const res = await apiRequest("POST", `/api/platform/tenants/${orgId}/import/batches/${previewResult.batchId}/commit`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import committed" });
      queryClient.invalidateQueries({ queryKey: batchesKey });
      setStep("done");
    },
    onError: (e: any) => toast({ title: "Commit failed", description: e.message, variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest("POST", `/api/platform/tenants/${orgId}/import/batches/${batchId}/rollback`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import rolled back" });
      queryClient.invalidateQueries({ queryKey: batchesKey });
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e.message, variant: "destructive" }),
  });

  const requiredFieldsMapped = uploadResult
    ? uploadResult.fieldSpec.filter((f) => f.required).every((f) => !!columnMapping[f.field])
    : false;

  return (
    <div className="space-y-4">
      <CardSection title="Import legacy data" description="Bulk-import this tenant's historical records from a POL360/Easipol/etc export. Column names don't need to match — map them below.">
        {step === "upload" && (
          <div className="space-y-4 max-w-lg">
            <div className="space-y-2">
              <Label>Data type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-source-system">Source system (optional)</Label>
              <Input id="li-source-system" placeholder="e.g. POL360, Easipol" value={sourceSystemLabel} onChange={(e) => setSourceSystemLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-file">File (.csv or .xlsx)</Label>
              <Input id="li-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <Button disabled={!file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload &amp; analyze
            </Button>
          </div>
        )}

        {step === "map" && uploadResult && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {uploadResult.totalRows} row(s) found in {file?.name}. Map each POL263 field to a column from your file.
            </p>
            {entityType === "policy" && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
                If you don't map a status column, policies start as <strong>inactive</strong>. If you also import
                that policy's payment history, status/grace/next-due-date get computed automatically from the
                real payment dates — the same way a live payment would. Only rely on a mapped status column if
                you're <em>not</em> also importing payment history.
              </p>
            )}
            {entityType === "payment" && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
                Import a policy's <strong>entire</strong> payment history in one batch — or, across separate
                batches, strictly in chronological order. Cycle dates are computed forward from each policy's
                current state, so importing history out of order will compute the wrong grace/lapsed status.
              </p>
            )}
            <div className="space-y-3 max-w-2xl">
              {uploadResult.fieldSpec.map((spec) => (
                <div key={spec.field} className="grid grid-cols-2 gap-3 items-center">
                  <Label className="flex items-center gap-1.5">
                    {spec.label}
                    {spec.required && <Badge variant="outline" className="text-[10px] px-1.5 py-0">required</Badge>}
                  </Label>
                  <Select
                    value={columnMapping[spec.field] || "__skip__"}
                    onValueChange={(v) => setColumnMapping((m) => ({ ...m, [spec.field]: v === "__skip__" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Skip this field" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">— Skip —</SelectItem>
                      {uploadResult.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {uploadResult.sampleRows.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Sample rows from your file</Label>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>{uploadResult.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploadResult.sampleRows.slice(0, 5).map((row, i) => (
                        <TableRow key={i}>
                          {uploadResult.headers.map((h) => <TableCell key={h} className="whitespace-nowrap">{row[h]}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetWizard}><ArrowLeft className="h-4 w-4 mr-2" />Start over</Button>
              <Button disabled={!requiredFieldsMapped || distinctValuesMutation.isPending || previewMutation.isPending} onClick={proceedFromMapping}>
                {(distinctValuesMutation.isPending || previewMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {entityType === "policy" && columnMapping.planName ? "Next: map plan names" : "Validate & preview"}
              </Button>
            </div>
          </div>
        )}

        {step === "valuemap" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Map each legacy plan/product name to a real product version, or leave it as the Legacy Import
              placeholder (premiums are stored directly on each policy either way — this is only for
              future reporting/renewal grouping).
            </p>
            <div className="space-y-3 max-w-2xl">
              {planValues.map((value) => (
                <div key={value} className="grid grid-cols-2 gap-3 items-center">
                  <Label>{value}</Label>
                  <Select
                    value={planValueMapping[value] || USE_LEGACY_PLACEHOLDER}
                    onValueChange={(v) => setPlanValueMapping((m) => {
                      if (v === USE_LEGACY_PLACEHOLDER) {
                        const { [value]: _omit, ...rest } = m;
                        return rest;
                      }
                      return { ...m, [value]: v };
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={USE_LEGACY_PLACEHOLDER}>— Legacy Import placeholder —</SelectItem>
                      {(productVersions || []).map((pv) => (
                        <SelectItem key={pv.id} value={pv.id}>{pv.productName || "Product"} (v{pv.version})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {planValues.length === 0 && <p className="text-sm text-muted-foreground">No plan name values found in that column.</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("map")}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
              <Button disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
                {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Validate &amp; preview
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && previewResult && (
          <div className="space-y-4">
            <div className="flex gap-4 text-sm">
              <div><span className="font-semibold">{previewResult.totalRows}</span> total rows</div>
              <div className="text-emerald-600"><span className="font-semibold">{previewResult.successRows}</span> valid</div>
              <div className="text-destructive"><span className="font-semibold">{previewResult.errorRows}</span> errors</div>
            </div>

            {previewResult.sampleErrors.length > 0 && (
              <div className="overflow-x-auto rounded-md border max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Row</TableHead><TableHead>Field</TableHead><TableHead>Issue</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewResult.sampleErrors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{e.rowIndex + 1}</TableCell>
                        <TableCell>{e.field}</TableCell>
                        <TableCell>{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetWizard}><ArrowLeft className="h-4 w-4 mr-2" />Start over</Button>
              <Button
                disabled={previewResult.successRows === 0 || commitMutation.isPending}
                onClick={() => commitMutation.mutate()}
              >
                {commitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Commit import ({previewResult.successRows} row{previewResult.successRows === 1 ? "" : "s"})
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="font-semibold">Import committed</p>
            <Button onClick={resetWizard}>Import another file</Button>
          </div>
        )}
      </CardSection>

      <CardSection title="Import history" description="Past import batches for this tenant." icon={History}>
        {batchesLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : !batches || batches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead><TableHead>File</TableHead><TableHead>Source</TableHead>
                  <TableHead>Status</TableHead><TableHead>Rows</TableHead><TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="capitalize">{b.entityType}</TableCell>
                    <TableCell>{b.fileName}</TableCell>
                    <TableCell>{b.sourceSystemLabel || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "committed" ? "default" : b.status === "failed" ? "destructive" : "outline"} className="capitalize">
                        {b.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{b.successRows}/{b.totalRows}</TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(b.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {b.status === "committed" && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setViewingAuditBatchId(b.id)}>
                              <Eye className="h-3.5 w-3.5 mr-1.5" />Audit trail
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setRollbackTargetId(b.id)}>
                              <Undo2 className="h-3.5 w-3.5 mr-1.5" />Roll back
                            </Button>
                          </>
                        )}
                      </div>
                      {b.rollbackBlockedReason && (
                        <p className="text-xs text-destructive mt-1 max-w-xs">{b.rollbackBlockedReason}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardSection>

      <Dialog open={!!viewingAuditBatchId} onOpenChange={(open) => !open && setViewingAuditBatchId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Synthesized audit trail</DialogTitle>
          </DialogHeader>
          {auditLoading ? (
            <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : !auditRows || auditRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No audit entries found for this batch.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Actor</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {auditRows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</TableCell>
                      <TableCell>{a.action}</TableCell>
                      <TableCell>{a.entityType}</TableCell>
                      <TableCell>{a.actorEmail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rollbackTargetId} onOpenChange={(open) => !open && setRollbackTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back this import?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes everything this batch created (and its synthesized audit trail) from the
              tenant's data. It's blocked if anything else now references these records — for example a policy
              written for an imported client. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={rollbackMutation.isPending}
              onClick={() => { if (rollbackTargetId) rollbackMutation.mutate(rollbackTargetId, { onSettled: () => setRollbackTargetId(null) }); }}
            >
              {rollbackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Roll back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
