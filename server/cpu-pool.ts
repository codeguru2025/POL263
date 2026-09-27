/**
 * Worker-thread pool for CPU-heavy, pure tasks (see server/workers/cpu-tasks.ts).
 *
 * Node runs all request handling on one thread. Seconds of pure CPU work there (parsing a
 * 30,000-row workbook, laying out a 50,000-row PDF) stalls every other request on the instance
 * until it finishes. Running that work on a worker thread keeps the main event loop free: on a
 * 1-vCPU instance the total CPU is the same, but the OS time-slices the threads, so ordinary
 * requests keep being served while the heavy job runs.
 *
 * Deliberately small and conservative for 1 GB instances:
 *  - workers start lazily and exit after CPU_WORKER_IDLE_MS idle (no standing memory cost);
 *  - each worker's heap is capped (CPU_WORKER_MAX_MB), so a malicious/zip-bomb upload kills
 *    that worker, not the server;
 *  - the queue is bounded (CPU_POOL_MAX_QUEUE) — callers get CpuPoolBusyError (503) instead of
 *    unbounded memory growth;
 *  - every task has a timeout (CPU_TASK_TIMEOUT_MS); a stuck worker is terminated.
 * If workers can't start at all (missing build artefact, CPU_POOL_DISABLED=true), tasks run
 * inline on the main thread — slower for everyone, but never broken.
 */
import { Worker } from "worker_threads";
import path from "path";
import fs from "fs";
import os from "os";
import { structuredLog } from "./logger";
import { cpuTasks, toBuffer, type CpuTaskName, type CpuTaskInput, type CpuTaskOutput } from "./workers/cpu-tasks";

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const POOL_SIZE = envInt("CPU_POOL_SIZE", Math.max(1, Math.min(2, os.availableParallelism() - 1)));
const MAX_QUEUE = envInt("CPU_POOL_MAX_QUEUE", 20);
const TASK_TIMEOUT_MS = envInt("CPU_TASK_TIMEOUT_MS", 120_000);
const WORKER_MAX_OLD_MB = envInt("CPU_WORKER_MAX_MB", 256);
const IDLE_TIMEOUT_MS = envInt("CPU_WORKER_IDLE_MS", 60_000);
const MAX_STARTUP_FAILURES = 3;

export class CpuPoolBusyError extends Error {
  readonly status = 503;
  constructor() {
    super("The server is busy processing other large files — please try again in a minute.");
    this.name = "CpuPoolBusyError";
  }
}

interface Job {
  id: number;
  name: CpuTaskName;
  payload: unknown;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  online: boolean;
  job: Job | null;
  taskTimer?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
}

interface WorkerSpec { file: string; execArgv: string[]; kind: "compiled" | "source" }

let spec: WorkerSpec | null | undefined;
let inlineOnly = process.env.CPU_POOL_DISABLED === "true";
let startupFailures = 0;
let nextJobId = 1;
const slots: Slot[] = [];
const queue: Job[] = [];
const stats = { completed: 0, failed: 0, timedOut: 0, rejectedBusy: 0, inlineRuns: 0, workersStarted: 0 };

function resolveWorkerSpec(): WorkerSpec | null {
  // Production: esbuild bundles to dist/index.cjs + dist/cpu-worker.cjs, so __dirname is dist/.
  if (typeof __dirname !== "undefined") {
    const compiled = path.join(__dirname, "cpu-worker.cjs");
    if (fs.existsSync(compiled)) return { file: compiled, execArgv: [], kind: "compiled" };
  }
  // Dev / tests: run the TypeScript source through tsx's loader.
  const source = path.resolve(process.cwd(), "server", "workers", "cpu-worker.ts");
  if (fs.existsSync(source)) return { file: source, execArgv: ["--import", "tsx"], kind: "source" };
  return null;
}

function getSpec(): WorkerSpec | null {
  if (spec === undefined) {
    spec = resolveWorkerSpec();
    if (!spec) {
      structuredLog("warn", "CPU worker script not found — heavy tasks will run on the main thread");
    }
  }
  return spec;
}

async function runInline(name: CpuTaskName, payload: unknown): Promise<unknown> {
  stats.inlineRuns++;
  return (cpuTasks[name] as (p: unknown) => Promise<unknown>)(payload);
}

function removeSlot(slot: Slot) {
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
  if (slot.taskTimer) clearTimeout(slot.taskTimer);
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
}

function spawnSlot(s: WorkerSpec): Slot {
  const worker = new Worker(s.file, {
    execArgv: s.execArgv,
    resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_MB },
  });
  stats.workersStarted++;
  const slot: Slot = { worker, online: false, job: null };
  worker.unref(); // an idle worker must never keep the process alive (ref()d while busy)

  worker.on("online", () => {
    slot.online = true;
    startupFailures = 0;
  });

  worker.on("message", (msg: { id: number; ok: boolean; result?: unknown; binary?: boolean; error?: string }) => {
    const job = slot.job;
    if (!job || job.id !== msg.id) return;
    if (slot.taskTimer) clearTimeout(slot.taskTimer);
    slot.job = null;
    slot.worker.unref();
    if (msg.ok) {
      stats.completed++;
      job.resolve(msg.binary ? toBuffer(msg.result as Uint8Array) : msg.result);
    } else {
      stats.failed++;
      job.reject(new Error(msg.error || "CPU task failed"));
    }
    dispatch();
  });

  const onDeath = (err: Error | null) => {
    const job = slot.job;
    const neverStarted = !slot.online;
    removeSlot(slot);
    slot.job = null;
    if (neverStarted) {
      startupFailures++;
      if (startupFailures >= MAX_STARTUP_FAILURES && !inlineOnly) {
        inlineOnly = true;
        structuredLog("error", "CPU worker pool failed to start repeatedly — running heavy tasks on the main thread", {
          error: err?.message,
        });
      }
    }
    if (job) {
      if (neverStarted) {
        // The work itself never ran — do it inline so the caller's request still succeeds.
        runInline(job.name, job.payload).then(job.resolve, job.reject);
      } else {
        stats.failed++;
        job.reject(err ?? new Error("CPU worker exited unexpectedly"));
      }
    }
    dispatch();
  };
  worker.on("error", (err) => {
    structuredLog("error", "CPU worker error", { error: err.message });
    onDeath(err);
  });
  worker.on("exit", (code) => {
    if (slots.includes(slot)) onDeath(code === 0 ? null : new Error(`CPU worker exited with code ${code}`));
  });

  slots.push(slot);
  return slot;
}

function startJob(slot: Slot, job: Job) {
  if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = undefined; }
  slot.job = job;
  slot.worker.ref();
  slot.taskTimer = setTimeout(() => {
    if (slot.job !== job) return;
    stats.timedOut++;
    slot.job = null;
    removeSlot(slot);
    slot.worker.terminate().catch(() => {});
    job.reject(new Error(`CPU task "${job.name}" timed out after ${Math.round(TASK_TIMEOUT_MS / 1000)}s`));
    dispatch();
  }, TASK_TIMEOUT_MS);
  slot.taskTimer.unref();
  slot.worker.postMessage({ id: job.id, name: job.name, payload: job.payload });
}

function dispatch() {
  while (queue.length > 0) {
    if (inlineOnly) {
      const job = queue.shift()!;
      runInline(job.name, job.payload).then(job.resolve, job.reject);
      continue;
    }
    let slot = slots.find((s) => s.job === null);
    if (!slot && slots.length < POOL_SIZE) {
      const s = getSpec();
      if (!s) { inlineOnly = true; continue; }
      slot = spawnSlot(s);
    }
    if (!slot) return; // all busy — jobs wait in the queue
    startJob(slot, queue.shift()!);
  }
  // Retire idle workers so a quiet instance holds no worker memory.
  for (const slot of slots) {
    if (slot.job === null && !slot.idleTimer) {
      slot.idleTimer = setTimeout(() => {
        if (slot.job !== null) return;
        removeSlot(slot);
        slot.worker.terminate().catch(() => {});
      }, IDLE_TIMEOUT_MS);
      slot.idleTimer.unref();
    }
  }
}

/** Run a registered CPU task on the worker pool (or inline if workers are unavailable). */
export function runCpuTask<N extends CpuTaskName>(name: N, payload: CpuTaskInput<N>): Promise<CpuTaskOutput<N>> {
  if (queue.length >= MAX_QUEUE) {
    stats.rejectedBusy++;
    return Promise.reject(new CpuPoolBusyError());
  }
  return new Promise<CpuTaskOutput<N>>((resolve, reject) => {
    queue.push({ id: nextJobId++, name, payload, resolve: resolve as (v: unknown) => void, reject });
    dispatch();
  });
}

export function getCpuPoolStats() {
  return {
    mode: inlineOnly ? "inline" : (getSpec()?.kind ?? "inline"),
    poolSize: POOL_SIZE,
    workers: slots.length,
    busy: slots.filter((s) => s.job !== null).length,
    queued: queue.length,
    ...stats,
  };
}

/** Terminate all workers (graceful shutdown). Queued jobs are rejected. */
export async function shutdownCpuPool(): Promise<void> {
  for (const job of queue.splice(0)) job.reject(new Error("Server shutting down"));
  const all = slots.splice(0);
  await Promise.all(all.map((s) => {
    if (s.taskTimer) clearTimeout(s.taskTimer);
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.job?.reject(new Error("Server shutting down"));
    return s.worker.terminate().catch(() => {});
  }));
}
