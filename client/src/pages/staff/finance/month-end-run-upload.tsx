import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";

export function MonthEndRunUpload({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      const form = new FormData();
      form.set("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/month-end-run", { method: "POST", headers, body: form, credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => { setFile(null); onSuccess(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const creditApplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/apply-credit-balances");
      const data = await res.json() as { applied: number; errors: string[] };
      return data;
    },
    onSuccess: (data) => {
      const applied = data?.applied ?? 0;
      const errCount = data?.errors?.length ?? 0;
      toast({ title: "Credit balance run complete", description: `Applied to ${applied} policies.${errCount ? ` ${errCount} errors.` : ""}` });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
      <div>
        <Label htmlFor="csv-file">CSV file</Label>
        <Input id="csv-file" type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
      </div>
      <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending} data-testid="button-run-month-end">
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Run
      </Button>
      {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => creditApplyMutation.mutate()} disabled={creditApplyMutation.isPending} data-testid="button-apply-credit-balances">
          {creditApplyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Apply credit balances (due premiums)
        </Button>
        <span className="text-xs text-muted-foreground">Runs auto-apply of credit balance to policies with due premium.</span>
      </div>
    </div>
  );
}
