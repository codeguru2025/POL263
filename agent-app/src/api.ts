import { API_BASE } from "./config";

let _csrfToken: string | null = null;

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
}

function getHeaders(mutating = false): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mutating && _csrfToken) {
    headers["X-XSRF-TOKEN"] = _csrfToken;
  }
  return headers;
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

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: getHeaders(true),
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || `POST ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function apiPatch<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: getHeaders(true),
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || `PATCH ${path} failed (${res.status})`);
  }
  return res.json();
}
