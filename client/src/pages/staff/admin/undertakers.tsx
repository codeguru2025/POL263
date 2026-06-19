import { DirectoryPage } from "@/components/directory-page";
import { Building2 } from "lucide-react";

export default function StaffUndertakers() {
  return (
    <DirectoryPage
      title="Undertakers"
      description="Directory of funeral parlors and mortuary services your organisation works with."
      icon={Building2}
      type="undertaker"
      singularLabel="undertaker"
      extraNotes="When a claim is lodged, you can reference an undertaker from this list for the funeral coordinator."
    />
  );
}
