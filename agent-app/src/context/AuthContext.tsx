import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { API_BASE } from "../config";
import { fetchCsrfToken, clearCsrfToken } from "../api";

interface User {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  branchId?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  loading: true,
  error: null,
  login: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync("auth_token");
        const storedUser = await SecureStore.getItemAsync("auth_user");
        if (stored && storedUser) {
          setToken(stored);
          setUser(JSON.parse(storedUser));
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Login failed (${res.status})`);
      }
      const data = await res.json();
      // Session cookie is set automatically via credentials: "include"
      const authToken = "session";
      const displayName = data.user?.displayName || data.displayName || email;
      const nameParts = displayName.trim().split(/\s+/);
      const userData: User = {
        id: data.user?.id || data.id,
        email: data.user?.email || data.email || email,
        displayName,
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        organizationId: data.user?.organizationId || data.organizationId || "",
        branchId: data.user?.branchId || data.branchId,
      };
      await SecureStore.setItemAsync("auth_token", authToken);
      await SecureStore.setItemAsync("auth_user", JSON.stringify(userData));
      setToken(authToken);
      setUser(userData);
      // Fetch CSRF token for subsequent mutating API calls
      await fetchCsrfToken();
    } catch (e: any) {
      setError(e.message || "Login failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    } finally {
      clearCsrfToken();
      await SecureStore.deleteItemAsync("auth_token");
      await SecureStore.deleteItemAsync("auth_user");
      setToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function extractCookie(res: Response, name: string): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}
