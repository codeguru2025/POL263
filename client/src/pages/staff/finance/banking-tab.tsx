import { TabsContent } from "@/components/ui/tabs";
import { BankingPanel } from "./banking-panel";

export function BankingTab() {
  return (
    <TabsContent value="banking">
      <BankingPanel />
    </TabsContent>
  );
}
