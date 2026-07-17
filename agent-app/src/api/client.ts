import CookieManager from "@preeternal/react-native-cookie-manager";
import { API_BASE } from "../config";

/**
 * React Native's fetch cannot read Set-Cookie response headers at all (a long-standing,
 * still-open RN limitation — headers.getSetCookie() doesn't work), and relying on the
 * native networking layer's *implicit* cookie jar is documented as unreliable across app
 * restarts, especially on iOS. CookieManager talks to the native cookie store directly,
 * bypassing both problems: after any request that may have set a session cookie, we
 * explicitly flush it to disk so it survives an app kill, not just backgrounding.
 */
async function persistCookies(): Promise<void> {
  try {
    await CookieManager.flush();
  } catch {
    // flush() is a no-op/unsupported on some platforms — session cookie may still have
    // been captured by the native layer even if explicit flush isn't available.
  }
}

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/agent-auth/csrf-token`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    csrfToken = data.token ?? null;
    return csrfToken;
  } catch {
    return null;
  }
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

/**
 * Core request helper. Mirrors client/src/lib/queryClient.ts's contract (relative path,
 * credentials included, CSRF header on mutations) but native-specific: no same-origin
 * fallback (API_BASE is always absolute here), and an explicit cookie flush after any
 * response that could have set/changed the session.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");

  if (MUTATING_METHODS.has(method)) {
    if (!csrfToken) await fetchCsrfToken();
    if (csrfToken) headers.set("X-XSRF-TOKEN", csrfToken);
  }

  let res = await fetch(`${API_BASE}${path}`, { ...init, method, headers, credentials: "include" });

  // csurf-protected requests 403 on a stale/missing token — refresh once and retry,
  // matching the pattern the removed agent-app's api.ts already proved out.
  if (res.status === 403 && MUTATING_METHODS.has(method)) {
    csrfToken = null;
    const refreshed = await fetchCsrfToken();
    if (refreshed) {
      headers.set("X-XSRF-TOKEN", refreshed);
      res = await fetch(`${API_BASE}${path}`, { ...init, method, headers, credentials: "include" });
    }
  }

  await persistCookies();
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body as any)?.message || `Request failed (${res.status})`) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

/** Clears the CSRF token cache — call on logout so a stale token isn't reused for the next login. */
export function resetCsrfToken(): void {
  csrfToken = null;
}
