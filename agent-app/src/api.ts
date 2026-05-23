import { API_BASE } from "./config";

function getHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const headers = getHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GET ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const headers = getHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
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
  const headers = getHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || `PATCH ${path} failed (${res.status})`);
  }
  return res.json();
}
