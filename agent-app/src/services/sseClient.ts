/**
 * Server-Sent Events client for real-time notifications.
 *
 * React Native doesn't have a native EventSource so we use fetch()
 * streaming. The connection is kept alive as long as the app is
 * foregrounded. Reconnects automatically on drop with exponential backoff.
 */

import { API_BASE } from "../config";

export interface SseEvent {
  type: string;
  id?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  unreadCount?: number;
  createdAt?: string;
}

type SseListener = (event: SseEvent) => void;

let abortController: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: SseListener[] = [];
let connected = false;
let orgId: string | null = null;

export function addSseListener(fn: SseListener): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function emit(event: SseEvent) {
  for (const fn of listeners) {
    try { fn(event); } catch { /* never crash the stream */ }
  }
}

export function isSseConnected(): boolean {
  return connected;
}

export function startSse(tenantOrgId: string): void {
  orgId = tenantOrgId;
  _connect(0);
}

export function stopSse(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (abortController) abortController.abort();
  abortController = null;
  reconnectTimer = null;
  connected = false;
  orgId = null;
}

async function _connect(attempt: number): Promise<void> {
  if (abortController) abortController.abort();
  abortController = new AbortController();

  const headers: Record<string, string> = { "Accept": "text/event-stream" };
  if (orgId) headers["X-Tenant-ID"] = orgId;

  try {
    const res = await fetch(`${API_BASE}/api/notifications/stream`, {
      headers,
      credentials: "include",
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE ${res.status}`);
    }

    connected = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const json = JSON.parse(dataLine.slice(5).trim());
          emit(json as SseEvent);
        } catch { /* malformed line */ }
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return; // intentional stop
  }

  connected = false;
  // Reconnect with exponential backoff: 2s, 4s, 8s … max 60s
  const delay = Math.min(2000 * Math.pow(2, attempt), 60_000);
  reconnectTimer = setTimeout(() => _connect(attempt + 1), delay);
}
