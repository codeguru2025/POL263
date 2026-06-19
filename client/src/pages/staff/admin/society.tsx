import { useEffect } from "react";
import { useLocation } from "wouter";

export default function StaffSocietyAdmin() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/staff/groups"); }, [setLocation]);
  return null;
}
