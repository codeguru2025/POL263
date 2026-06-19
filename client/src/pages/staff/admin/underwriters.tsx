import { DirectoryPage } from "@/components/directory-page";
import { ShieldCheck } from "lucide-react";

export default function StaffUnderwriters() {
  return (
    <DirectoryPage
      title="Underwriters"
      description="Reinsurance companies and underwriting partners that back your policy products."
      icon={ShieldCheck}
      type="underwriter"
      singularLabel="underwriter"
      extraNotes="Each product can be linked to an underwriter for reinsurance tracking and reporting."
    />
  );
}
