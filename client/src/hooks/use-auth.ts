import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  organizationId: string | null;
  isActive: boolean;
  referralCode: string | null;
}

interface AuthSession {
  user: AuthUser;
  roles: { name: string; branchId: string | null }[];
  permissions: string[];
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: session, isLoading, error, isError } = useQuery<AuthSession | null>({
    queryKey: ["/api/auth/me"],
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
    isLoading,
    isError,
    error: error instanceof Error ? error.message : undefined,
    logout: logoutMutation.mutateAsync,
  };
}
