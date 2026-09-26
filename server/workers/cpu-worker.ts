/**
 * Worker-thread entry point for server/cpu-pool.ts. Built to dist/cpu-worker.cjs by
 * script/build.ts; run straight from source (via tsx) in dev and tests.
 */
import { parentPort } from "worker_threads";
import { cpuTasks, type CpuTaskName } from "./cpu-tasks";

interface TaskMessage { id: number; name: CpuTaskName; payload: unknown }

if (!parentPort) throw new Error("cpu-worker must be started as a worker thread");
const port = parentPort;

port.on("message", async (msg: TaskMessage) => {
  try {
    const task = cpuTasks[msg.name] as ((p: unknown) => Promise<unknown>) | undefined;
    if (!task) throw new Error(`Unknown CPU task: ${String(msg.name)}`);
    const result = await task(msg.payload);
    if (result instanceof Uint8Array) {
      // Copy into a fresh ArrayBuffer and transfer it (zero-copy hand-off). Transferring the
      // Buffer's own backing store is unsafe: small Buffers share Node's allocation pool.
      const out = new Uint8Array(result.byteLength);
      out.set(result);
      port.postMessage({ id: msg.id, ok: true, result: out, binary: true }, [out.buffer]);
    } else {
      port.postMessage({ id: msg.id, ok: true, result });
    }
  } catch (err) {
    const e = err as Error;
    port.postMessage({ id: msg.id, ok: false, error: e?.message || String(err) });
  }
});
