import { apiJson } from "./client";

export interface ClientUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone?: string | null;
}

/** server/client-auth.ts:210 — login is by policy number + password, not email.
 *  Exempt from CSRF (server/index.ts CSRF_EXEMPT_PATHS) since there's no session yet
 *  to carry a CSRF secret cookie from. */
export async function clientLogin(policyNumber: string, password: string): Promise<{ client: ClientUser }> {
  return apiJson("/api/client-auth/login", {
    method: "POST",
    body: JSON.stringify({ policyNumber, password }),
  });
}

export async function getMe(): Promise<{ client: ClientUser }> {
  return apiJson("/api/client-auth/me");
}

export async function clientLogout(): Promise<void> {
  await apiJson("/api/client-auth/logout", { method: "POST" });
}

export interface SecurityQuestion {
  id: string;
  question: string;
}

/** First-time enrollment step 1: activation code (issued when the policy was created)
 *  + policy number identifies the client and returns the security question to answer. */
export async function claimPolicy(activationCode: string, policyNumber: string): Promise<{
  clientId: string; firstName: string; securityQuestions: SecurityQuestion[];
}> {
  return apiJson("/api/client-auth/claim", {
    method: "POST",
    body: JSON.stringify({ activationCode, policyNumber }),
  });
}

/** Step 2: set password + answer the security question (used later for password reset). */
export async function enrollClient(input: {
  clientId: string; password: string; securityQuestionId: string; securityAnswer: string; referralCode?: string;
}): Promise<void> {
  await apiJson("/api/client-auth/enroll", { method: "POST", body: JSON.stringify(input) });
}

export async function resetPassword(policyNumber: string, securityAnswer: string, newPassword: string): Promise<void> {
  await apiJson("/api/client-auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ policyNumber, securityAnswer, newPassword }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiJson("/api/client-auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface TenantBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  isWhitelabeled: boolean;
}

/** Only resolvable once a session exists (server derives org from the session, not the
 *  request) — unlike agent-app's public branding fetch, there's no pre-login tenant
 *  branding endpoint for clients since policy-number login doesn't reveal the org
 *  up front. The login screen itself is neutral/unbranded. */
export async function getTenantBranding(): Promise<TenantBranding> {
  return apiJson("/api/client-auth/tenant");
}
