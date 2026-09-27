/**
 * Registry of CPU-heavy tasks that run on the worker pool (server/cpu-pool.ts).
 *
 * Rules for adding a task:
 *  - Pure: plain data in, plain data (or a Buffer) out. No DB, session, storage or network
 *    imports — a worker has its own module graph, and pulling in server/db.ts would open a
 *    second set of Postgres pools per worker.
 *  - Worth it: only work that blocks the event loop for a long, single stretch (large
 *    spreadsheet parses, PDFs with thousands of rows). A one-page receipt is cheaper inline
 *    than the structured-clone round trip to a worker.
 */
import { parseSpreadsheetBuffer, type ParsedFile } from "../spreadsheet-parse";
import { renderSmsReportPdf, type SmsReportPdfInput } from "../sms-report-pdf";
import { threadId } from "worker_threads";

export const cpuTasks = {
  parseSpreadsheet: (p: { buffer: Uint8Array; fileName: string }): Promise<ParsedFile> =>
    parseSpreadsheetBuffer(toBuffer(p.buffer), p.fileName),
  smsReportPdf: (p: SmsReportPdfInput): Promise<Buffer> => renderSmsReportPdf(p),
  /** Diagnostics: proves which thread ran the task. */
  threadInfo: async (_p: Record<string, never>): Promise<{ threadId: number }> => ({ threadId }),
};

export type CpuTaskName = keyof typeof cpuTasks;
export type CpuTaskInput<N extends CpuTaskName> = Parameters<(typeof cpuTasks)[N]>[0];
export type CpuTaskOutput<N extends CpuTaskName> = Awaited<ReturnType<(typeof cpuTasks)[N]>>;

/** Structured clone turns a Buffer into a plain Uint8Array — wrap it back without copying. */
export function toBuffer(u: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength);
}
