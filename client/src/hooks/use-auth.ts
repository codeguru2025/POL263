import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  organizationId: string | null;
  isActive: boolean;
  referralCode: string | null;
  isPlatformOwner?: boolean;
}

interface AuthSession {
  user: AuthUser;
  roles: { name: string; branchId: string | null }[];
  permissions: string[];
}

/** Auth/me never throws so reload in production does not hit the Error Boundary (e.g. on 500 or network). */
async function fetchAuthSession(): Promise<AuthSession | null> {
  try {
    const url = getApiBase() + "/api/auth/me";
    const res = await fetch(url, { credentials: "include" });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
