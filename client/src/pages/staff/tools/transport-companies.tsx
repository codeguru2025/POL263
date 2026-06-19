import { DirectoryPage } from "@/components/directory-page";
import { Truck } from "lucide-react";

export default function StaffTransportCompanies() {
  return (
    <DirectoryPage
      title="Transport companies"
      description="Service providers for coffin transport, tents, chairs, PA systems, and other funeral logistics. Use the Notes field to record fleet details or pricing."
      icon={Truck}
      type="transport_company"
      singularLabel="transport company"
      extraNotes="Tip: add vehicle types, capacity, and rates in the Notes field so coordinators can book the right provider quickly."
    />
  );
}
