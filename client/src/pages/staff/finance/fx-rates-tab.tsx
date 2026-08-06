import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { QK_FX_RATES } from "./query-keys";

export function FxRatesTab({ fxRateMap }: { fxRateMap: Record<string, string> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fxEdits, setFxEdits] = useState<Record<string, string>>({});
  const saveFxRateMutation = useMutation({
    mutationFn: async ({ currency, rateToUsd }: { currency: string; rateToUsd: string }) => {
      const res = await apiRequest("PUT", `/api/fx-rates/${currency}`, { rateToUsd });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_FX_RATES });
      toast({ title: "Exchange rate saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <TabsContent value="fx-rates">
      <CardSection
        title="Exchange Rates (USD base)"
        description="Set how many USD one unit of each currency is worth. Used to compute the consolidated USD total on the Income Statement and Cash Flow. USD is fixed at 1.00."
        icon={DollarSign}
        flush
      >
        <div className="p-4 space-y-3 max-w-md">
          <div className="flex items-center gap-3">
            <span className="w-16 font-mono font-semibold">USD</span>
            <Input value="1.00000000" disabled className="flex-1" />
            <span className="text-xs text-muted-foreground w-20">base</span>
          </div>
          {["ZAR", "ZIG"].map((cur) => (
            <div key={cur} className="flex items-center gap-3">
              <span className="w-16 font-mono font-semibold">{cur}</span>
              <Input
                type="number" step="0.00000001" min="0"
                placeholder={`USD per 1 ${cur}`}
                value={fxEdits[cur] ?? fxRateMap[cur] ?? ""}
                onChange={(e) => setFxEdits({ ...fxEdits, [cur]: e.target.value })}
                className="flex-1"
                data-testid={`input-fx-${cur}`}
              />
              <Button
                size="sm"
                onClick={() => saveFxRateMutation.mutate({ currency: cur, rateToUsd: fxEdits[cur] ?? fxRateMap[cur] ?? "0" })}
                disabled={saveFxRateMutation.isPending || !(fxEdits[cur] ?? fxRateMap[cur])}
                data-testid={`btn-save-fx-${cur}`}
              >Save</Button>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Example: if 1 USD = 28 ZiG, then 1 ZiG = 0.0357 USD — enter 0.0357 for ZIG.</p>
        </div>
      </CardSection>
    </TabsContent>
  );
}
