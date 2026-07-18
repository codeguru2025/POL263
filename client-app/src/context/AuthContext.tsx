import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clientLogin, clientLogout, getMe, type ClientUser } from "../api/auth";
import { resetCsrfToken } from "../api/client";

interface AuthState {
  client: ClientUser | null;
  isLoading: boolean;
  signIn: (policyNumber: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ClientUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setClient(me.client);
    } catch {
      setClient(null);
    }
  }, []);

  // On mount: the session cookie may already be valid from a previous app launch
  // (see src/api/client.ts's persistCookies) — check before assuming logged-out.
  useEffect(() => {
    (async () => {
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(async (policyNumber: string, password: string) => {
    const { client: c } = await clientLogin(policyNumber, password);
    setClient(c);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await clientLogout();
    } finally {
      resetCsrfToken();
      setClient(null);
    }
  }, []);

  const value = useMemo<AuthState>(() => ({ client, isLoading, signIn, signOut, refresh }), [client, isLoading, signIn, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
