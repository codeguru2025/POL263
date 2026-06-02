import { API_BASE } from "./config";

let _csrfToken: string | null = null;
let _orgId: string | null = null;

/** Fetch and cache the CSRF token from the server. Call once after login. */
export async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/agent-auth/csrf-token`, {
      method: "GET",
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      _csrfToken = data.token ?? null;
    }
  } catch {
    // Non-fatal: server may not have CSRF enabled (dev mode)
  }
}

/** Clear stored CSRF token on logout. */
export function clearCsrfToken(): void {
  _csrfToken = null;
  _orgId = null;
}

/**
 * Store the agent's organizationId after login.
 * This is sent as X-Tenant-ID on every request so the server's tenant
 * resolver can scope the request correctly without relying on subdomain routing.
 */
export function setOrgId(orgId: string | null): void {
  _orgId = orgId || null;
}

/** Returns the tenant-scoped document URL for opening in a browser. */
export function policyDocumentUrl(policyServerId: string, lang = "en"): string {
  const base = `${API_BASE}/api/policies/${policyServerId}/document?lang=${lang}`;
  return _orgId ? `${base}&orgId=${encodeURIComponent(_orgId)}` : base;
}

function getHeaders(mutating = false): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mutating && _csrfToken) {
    headers["X-XSRF-TOKEN"] = _csrfToken;
  }
  if (_orgId) {
    headers["X-Tenant-ID"] = _orgId;
  }
  return headers;
}

/**
 * Returns headers suitable for mutating requests (POST/PATCH/DELETE).
 * Includes CSRF token and X-Tenant-ID if available.
 * Exported so the sync engine's raw fetch calls stay in sync with api.ts.
 */
export function getMutatingHeaders(): Record<string, string> {
  return getHeaders(true);
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GET ${path} failed (${res.status})`);
  }
  return res.json();
}

async function mutate<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: any, isRetry = false): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: getHeaders(true),
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // On 403, the CSRF token may have expired — refresh it and retry once.
    if (res.status === 403 && !isRetry) {
      await fetchCsrfToken();
      return mutate<T>(method, path, body, true);
    }
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || `${method} ${path} failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  return mutate<T>("POST", path, body);
}

export async function apiPatch<T = any>(path: string, body?: any): Promise<T> {
  return mutate<T>("PATCH", path, body);
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  return mutate<T>("DELETE", path);
}
