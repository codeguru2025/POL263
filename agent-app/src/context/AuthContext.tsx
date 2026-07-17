import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as WebBrowser from "expo-web-browser";
import { DEEP_LINK_SCHEME } from "../config";
import { API_BASE } from "../config";
import { agentLogin, agentLogout, exchangeMobileAuthToken, getMe, type AuthUser, type Role } from "../api/auth";
import { resetCsrfToken } from "../api/client";

/** Must exactly match the server's hardcoded redirect (server/auth.ts:443,
 *  `pol263://auth/callback`) — not built via Linking.createURL(), since that produces a
 *  different (exp://...) URL under Expo Go that the server has no way to redirect to.
 *  This means Google sign-in only works in a standalone/dev-client build, not Expo Go. */
const OAUTH_REDIRECT_URL = `${DEEP_LINK_SCHEME}://auth/callback`;

interface AuthState {
  user: AuthUser | null;
  roles: Role[];
  permissions: string[];
  isLoading: boolean;
  isAgent: boolean;
  signInAgent: (email: string, password: string, orgId?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const applyMe = useCallback((me: { user: AuthUser; roles: Role[]; permissions: string[] }) => {
    setUser(me.user);
    setRoles(me.roles);
    setPermissions(me.permissions);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setRoles([]);
    setPermissions([]);
  }, []);

  // On mount: the session cookie may already be valid from a previous app launch
  // (see src/api/client.ts's persistCookies) — check before assuming logged-out.
  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        applyMe(me);
      } catch {
        // Not authenticated — normal for a first launch, not an error to surface.
      } finally {
        setIsLoading(false);
      }
    })();
  }, [applyMe]);

  const signInAgent = useCallback(async (email: string, password: string, orgId?: string) => {
    await agentLogin(email, password, orgId);
    const me = await getMe();
    applyMe(me);
  }, [applyMe]);

  const signInWithGoogle = useCallback(async () => {
    const authUrl = `${API_BASE}/api/auth/google?returnTo=mobile`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, OAUTH_REDIRECT_URL);
    if (result.type !== "success" || !result.url) {
      throw new Error(result.type === "cancel" || result.type === "dismiss" ? "Sign-in cancelled" : "Sign-in failed");
    }
    const token = new URL(result.url).searchParams.get("token");
    if (!token) throw new Error("Sign-in did not return a valid token");
    await exchangeMobileAuthToken(token);
    const me = await getMe();
    applyMe(me);
  }, [applyMe]);

  const signOut = useCallback(async () => {
    try {
      await agentLogout();
    } finally {
      resetCsrfToken();
      clearSession();
    }
  }, [clearSession]);

  // Mirrors shared/roles.ts isAgentScoped() exactly (not imported directly — Metro doesn't
  // read the Vite/tsconfig path aliases shared/ relies on in the web app; duplicated here
  // deliberately rather than fighting bundler config for one small function). A user with
  // "agent" AND a superior role (administrator/manager/superuser) gets the broader view,
  // not the agent-scoped one — same multi-role behavior as web.
  const isAgent = useMemo(() => {
    const hasAgent = roles.some((r) => r.name === "agent");
    if (!hasAgent) return false;
    const AGENT_SCOPE_OVERRIDE_ROLES = new Set(["superuser", "administrator", "manager"]);
    return !roles.some((r) => AGENT_SCOPE_OVERRIDE_ROLES.has(r.name));
  }, [roles]);

  const value = useMemo<AuthState>(() => ({
    user, roles, permissions, isLoading, isAgent, signInAgent, signInWithGoogle, signOut,
  }), [user, roles, permissions, isLoading, isAgent, signInAgent, signInWithGoogle, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
