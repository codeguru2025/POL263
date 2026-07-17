import { apiJson } from "./client";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  organizationId: string | null;
  branchId: string | null;
  isActive: boolean;
  referralCode: string | null;
  isPlatformOwner: boolean;
}

export interface Role {
  name: string;
  branchId: string | null;
}

export interface Me {
  user: AuthUser;
  roles: Role[];
  permissions: string[];
}

/** Agents cannot use Google sign-in (server enforces this) — email+password only.
 *  orgId is the native-app equivalent of the web app's subdomain tenant resolution
 *  (server/auth.ts:640 falls back to req.body.orgId when there's no subdomain to read). */
export async function agentLogin(email: string, password: string, orgId?: string): Promise<{ user: AuthUser }> {
  return apiJson("/api/agent-auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), password, orgId }),
  });
}

/** Exchanges the one-time token minted by the server after a successful Google OAuth
 *  round-trip in the system browser (server/auth.ts's mobileAuthTokens handoff) for a
 *  real session — this establishes the same cookie session agentLogin does. */
export async function exchangeMobileAuthToken(token: string): Promise<{ user: AuthUser }> {
  return apiJson("/api/auth/mobile-exchange", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function getMe(): Promise<Me> {
  return apiJson("/api/auth/me");
}

export async function agentLogout(): Promise<void> {
  await apiJson("/api/agent-auth/logout", { method: "POST" });
}
