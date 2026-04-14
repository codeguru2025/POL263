import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

export default function StaffTenants() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/staff/settings?tab=tenants", { replace: true });
  }, [setLocation]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
