import { useQueryClient } from "@tanstack/react-query";
import { CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/queryClient";
import { MonthEndRunUpload } from "./month-end-run-upload";
import { QK_PAYMENTS } from "./query-keys";

export function MonthEndTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return (
    <TabsContent value="month-end">
      <CardSection
        title="Month-end run"
        description="Upload a CSV with policy_number, amount, currency. Policies with sufficient amount are receipted; underpayments go to policy credit balance and a credit note is issued."
        icon={FileText}
      >
        <div className="flex items-center gap-4">
          <Button variant="outline" asChild>
            <a href={getApiBase() + "/api/month-end-run/template"} download="month-end-run-template.csv" data-testid="button-download-month-end-template">
              Download template
            </a>
          </Button>
        </div>
        <MonthEndRunUpload onSuccess={() => { toast({ title: "Month-end run completed" }); queryClient.invalidateQueries({ queryKey: QK_PAYMENTS }); }} />
      </CardSection>
    </TabsContent>
  );
}
