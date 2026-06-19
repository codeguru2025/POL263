import { DirectoryPage } from "@/components/directory-page";
import { BookUser } from "lucide-react";

export default function StaffContacts() {
  return (
    <DirectoryPage
      title="Contacts"
      description="General address book — lawyers, regulators, suppliers, emergency contacts, and anyone else your team needs quick access to."
      icon={BookUser}
      type="contact"
      singularLabel="contact"
    />
  );
}
