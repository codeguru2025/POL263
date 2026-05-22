/**
 * Lightweight async job dispatcher.
 *
 * Runs background tasks (PDF generation, commission calculation, notification
 * dispatch) without blocking the HTTP response. Jobs are fire-and-forget with
 * structured error logging. When REDIS_URL is available in production, this
 * module can be swapped for BullMQ workers.
 *
 * Usage:
 *   import { enqueueJob } from "./job-queue";
 *   enqueueJob("receipt-pdf", { receiptId }, async () => { ... });
 */
import { structuredLog } from "./logger";

interface JobEntry {
  name: string;
  data: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

const recentJobs: JobEntry[] = [];
const MAX_RECENT = 200;
let activeCount = 0;
const MAX_CONCURRENT = parseInt(process.env.JOB_MAX_CONCURRENT || "5", 10);
// Fix 10: Cap in-memory queue to prevent OOM under burst load.
const MAX_PENDING_JOBS = parseInt(process.env.JOB_MAX_PENDING || "500", 10);
const pendingQueue: (() => void)[] = [];

function trackJob(entry: JobEntry) {
  recentJobs.push(entry);
  if (recentJobs.length > MAX_RECENT) recentJobs.shift();
}

function tryRunNext() {
  while (activeCount < MAX_CONCURRENT && pendingQueue.length > 0) {
    const run = pendingQueue.shift()!;
    run();
  }
}

/**
 * Enqueue a background job. The callback runs asynchronously after the current
 * event loop tick, so the caller's HTTP response is not delayed.
 */
export function enqueueJob(
  name: string,
  data: Record<string, unknown>,
  fn: () => Promise<void>,
): void {
  const entry: JobEntry = { name, data, status: "pending", enqueuedAt: Date.now() };
  trackJob(entry);

  const execute = () => {
    activeCount++;
    entry.status = "running";
    entry.startedAt = Date.now();

    fn()
      .then(() => {
        entry.status = "completed";
        entry.completedAt = Date.now();
      })
      .catch((err) => {
        entry.status = "failed";
        entry.completedAt = Date.now();
        entry.error = err?.message || String(err);
        structuredLog("error", `Background job failed: ${name}`, {
          jobName: name,
          data,
          error: entry.error,
          durationMs: (entry.completedAt || 0) - (entry.startedAt || 0),
        });
      })
      .finally(() => {
        activeCount--;
        tryRunNext();
      });
  };

  if (activeCount < MAX_CONCURRENT) {
    setImmediate(execute);
  } else if (pendingQueue.length >= MAX_PENDING_JOBS) {
    // Fix 10: Queue full — drop job and log rather than growing the heap unboundedly.
    entry.status = "failed";
    entry.completedAt = Date.now();
    entry.error = "Job queue full — dropped";
    structuredLog("error", `Background job dropped: queue full (${MAX_PENDING_JOBS})`, {
      jobName: name,
      data,
      pending: pendingQueue.length,
    });
  } else {
    pendingQueue.push(execute);
  }
}

/**
 * Fix 11: Wait until all currently active jobs have finished (or timeout expires).
 * Call this from the SIGTERM handler before process.exit() to avoid dropping in-flight work.
 */
export function drainActiveJobs(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    if (activeCount === 0) return resolve();
    const deadline = setTimeout(() => {
      structuredLog("warn", "drainActiveJobs: timed out waiting for active jobs", {
        activeCount,
        timeoutMs,
      });
      resolve();
    }, timeoutMs);
    const interval = setInterval(() => {
      if (activeCount === 0) {
        clearInterval(interval);
        clearTimeout(deadline);
        resolve();
      }
    }, 100);
  });
}

export function getJobStats(): {
  active: number;
  pending: number;
  maxConcurrent: number;
  recent: { name: string; status: string; enqueuedAt: number; durationMs?: number; error?: string }[];
} {
  return {
    active: activeCount,
    pending: pendingQueue.length,
    maxConcurrent: MAX_CONCURRENT,
    recent: recentJobs.slice(-20).map((j) => ({
      name: j.name,
      status: j.status,
      enqueuedAt: j.enqueuedAt,
      durationMs: j.completedAt && j.startedAt ? j.completedAt - j.startedAt : undefined,
      error: j.error,
    })),
  };
}
