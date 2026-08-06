import { useQueryClient } from "@tanstack/react-query";
import { TabsContent } from "@/components/ui/tabs";
import { PendingApprovalsPanel } from "./pending-approvals-panel";
import { QK_PAYMENTS, QK_PENDING_APPROVALS } from "./query-keys";

export function ApprovalsTab() {
  const queryClient = useQueryClient();
  return (
    <TabsContent value="approvals">
      <PendingApprovalsPanel onApproved={() => { queryClient.invalidateQueries({ queryKey: QK_PAYMENTS }); queryClient.invalidateQueries({ queryKey: QK_PENDING_APPROVALS }); }} />
    </TabsContent>
  );
}
