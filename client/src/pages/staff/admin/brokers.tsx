import { DirectoryPage } from "@/components/directory-page";
import { Handshake } from "lucide-react";

export default function StaffBrokers() {
  return (
    <DirectoryPage
      title="Brokers"
      description="External brokerage firms and distribution partners that refer or sell your products. Use Notes to record commission rates, territory, or agreement reference numbers."
      icon={Handshake}
      type="broker"
      singularLabel="broker"
      extraNotes="Broker commission calculations are recorded under Reports → Commissions Summary."
    />
  );
}
