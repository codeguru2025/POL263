import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError("No auth token received. Please try signing in again.");
      return;
    }

    apiRequest("POST", "/api/auth/mobile-exchange", { token })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        setLocation("/staff");
      })
      .catch((err: any) => {
        const raw = err?.message || "Authentication failed";
        const match = raw.match(/\d+:\s*(.+)/);
        if (match) {
          try { setError(JSON.parse(match[1]).message || match[1]); } catch { setError(match[1]); }
        } else {
          setError(raw);
        }
      });
  }, []); // run once on mount

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => setLocation("/staff/login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
