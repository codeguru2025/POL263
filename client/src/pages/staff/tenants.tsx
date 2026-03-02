import { useEffect } from "react";
import { useLocation } from "wouter";

export default function StaffTenants() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/staff/settings?tab=tenants");
  }, [setLocation]);
  return null;
}
