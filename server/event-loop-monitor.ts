/**
 * Event-loop lag monitoring. Node serves every request on one thread, so any synchronous CPU
 * work (a huge PDF, a big spreadsheet, a JSON.stringify of 100k rows) delays ALL requests on
 * the instance for as long as it runs. This samples the loop's scheduling delay and logs a
 * warning when a stall crosses EVENT_LOOP_WARN_MS, so the next candidate for the CPU worker
 * pool (server/cpu-pool.ts) is picked from production evidence rather than guesswork.
 *
 * Correlate a warning's timestamp with the request log lines ("GET /api/... in 4200ms") around
 * it to find the handler that caused the stall.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "perf_hooks";
import { structuredLog } from "./logger";

const WINDOW_MS = 60_000;
const WARN_MS = (() => {
  const n = parseInt(process.env.EVENT_LOOP_WARN_MS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

let histogram: IntervalHistogram | null = null;
let timer: NodeJS.Timeout | null = null;
let lastWindow: { p50Ms: number; p99Ms: number; maxMs: number; at: string } | null = null;
let worstSinceStart = { maxMs: 0, at: "" };

const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

export function startEventLoopMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  timer = setInterval(() => {
    const h = histogram!;
    const window = { p50Ms: ms(h.percentile(50)), p99Ms: ms(h.percentile(99)), maxMs: ms(h.max), at: new Date().toISOString() };
    lastWindow = window;
    if (window.maxMs > worstSinceStart.maxMs) worstSinceStart = { maxMs: window.maxMs, at: window.at };
    if (window.maxMs >= WARN_MS) {
      structuredLog("warn", "Event loop stalled — a request handler ran synchronous CPU work", {
        maxStallMs: window.maxMs, p99Ms: window.p99Ms, windowSeconds: WINDOW_MS / 1000,
      });
    }
    h.reset();
  }, WINDOW_MS);
  timer.unref();
}

export function stopEventLoopMonitor(): void {
  if (timer) clearInterval(timer);
  histogram?.disable();
  timer = null;
  histogram = null;
}

export function getEventLoopStats() {
  return { warnThresholdMs: WARN_MS, lastMinute: lastWindow, worstSinceStart };
}
