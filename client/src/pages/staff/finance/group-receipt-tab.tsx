import { useQueryClient } from "@tanstack/react-query";
import { CardSection } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GroupReceiptForm } from "./group-receipt-form";
import { QK_PAYMENTS } from "./query-keys";

export function GroupReceiptTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return (
    <TabsContent value="group-receipt">
      <CardSection
        title="Group receipt"
        description="Select a group and policies to receipt at once. Total amount is split by premium proportion. Backdated receipts require manager approval."
        icon={Receipt}
      >
        <GroupReceiptForm onSuccess={() => { toast({ title: "Group receipted" }); queryClient.invalidateQueries({ queryKey: QK_PAYMENTS }); }} />
      </CardSection>
    </TabsContent>
  );
}
