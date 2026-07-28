import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  organizationId: string | null;
  /** For platform owners: selected tenant id from session; else same as organizationId */
  effectiveOrganizationId?: string | null;
  isActive: boolean;
  referralCode: string | null;
  isPlatformOwner?: boolean;
  phone?: string | null;
  bio?: string | null;
  whatsapp?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
}

interface AuthSession {
  user: AuthUser;
  roles: { name: string; branchId: string | null }[];
  permissions: string[];
}

/** Only 401/403 mean "not logged in" (returns null). A real outage — network failure or a
 *  5xx from the server — throws instead, so callers (see staff-layout.tsx's authError branch)
 *  can tell "your session expired" apart from "the server is down" rather than bouncing both
 *  to the same plain login page with no explanation. */
async function fetchAuthSession(): Promise<AuthSession | null> {
  const url = getApiBase() + "/api/auth/me";
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch {
    throw new Error("Server unavailable. Please try again.");
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error("Server unavailable. Please try again.");
  return await res.json();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: session, isLoading, error, isError } = useQuery<AuthSession | null>({
    queryKey: ["/api/auth/me"],
    queryFn: fetchAuthSession,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      const text = await res.text();
      if (!text.trim()) return {};
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  return {
    user: session?.user ?? null,
    roles: session?.roles ?? [],
    permissions: session?.permissions ?? [],
    isAuthenticated: !!session?.user,
    isPlatformOwner: session?.user?.isPlatformOwner ?? false,
    isLoading,
    isError,
    error: error instanceof Error ? error.message : undefined,
    logout: logoutMutation.mutateAsync,
  };
}
