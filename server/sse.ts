/**
 * Server-Sent Events (SSE) real-time notification delivery.
 *
 * Under 500 concurrent users: in-process Map<userId, Response[]>.
 * Each authenticated client opens GET /api/notifications/stream and
 * keeps it alive. On new notification, sseEmit() pushes the event
 * to all the user's open tabs/devices immediately.
 *
 * ── Upgrade path for >500 concurrent users ──────────────────────
 * Set REALTIME_BACKEND=redis in env. Replace the in-process Map with
 * a Redis pub/sub channel per org. Each server process subscribes and
 * forwards events to its local SSE connections.
 *
 * Sketch (do not activate until REALTIME_BACKEND=redis is set):
 *
 *   import { createClient } from "redis";
 *   const pub = createClient({ url: process.env.REDIS_URL });
 *   const sub = pub.duplicate();
 *   await pub.connect(); await sub.connect();
 *
 *   // Publish from sseEmit():
 *   await pub.publish(`sse:${userId}`, JSON.stringify(event));
 *
 *   // In each SSE connection handler, subscribe once per userId:
 *   await sub.subscribe(`sse:${userId}`, (msg) => {
 *     res.write(`data: ${msg}\n\n`);
 *   });
 *
 *   // On connection close: sub.unsubscribe(`sse:${userId}`)
 * ────────────────────────────────────────────────────────────────
 */

import type { Request, Response } from "express";

// userId → array of open SSE response streams (multiple tabs/devices)
const connections = new Map<string, Set<Response>>();

/** Register an SSE connection for a user. Returns cleanup fn. */
export function sseConnect(userId: string, req: Request, res: Response): () => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Keep-alive ping every 25s to prevent proxy timeouts
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { cleanup(); }
  }, 25_000);

  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId)!.add(res);

  function cleanup() {
    clearInterval(ping);
    const set = connections.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) connections.delete(userId);
    }
  }

  req.on("close", cleanup);
  req.on("error", cleanup);

  // Confirm connection
  res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

  return cleanup;
}

export interface SseEvent {
  type: string;
  id?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  unreadCount?: number;
  createdAt?: string;
}

/** Push an event to all open SSE connections for a user. */
export function sseEmit(userId: string, event: SseEvent): void {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of Array.from(set)) {
    try { res.write(payload); } catch { /* connection already closed */ }
  }
}

/** How many users currently have active SSE connections. */
export function sseActiveCount(): number {
  return connections.size;
}
