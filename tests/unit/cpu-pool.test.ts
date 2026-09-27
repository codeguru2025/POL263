import { describe, it, expect, afterAll } from "vitest";
import { threadId } from "worker_threads";
import ExcelJS from "exceljs";
import { runCpuTask, getCpuPoolStats, shutdownCpuPool } from "../../server/cpu-pool";

afterAll(async () => {
  await shutdownCpuPool();
});

async function buildWorkbook(rows: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["policy_number", "first_name", "amount"]);
  for (let i = 0; i < rows; i++) ws.addRow([`POL${i}`, `Name ${i}`, 25.5]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("CPU worker pool", () => {
  it("runs tasks on a worker thread, not the main thread", async () => {
    const info = await runCpuTask("threadInfo", {});
    expect(threadId).toBe(0);
    expect(info.threadId).not.toBe(0);
    expect(getCpuPoolStats().mode).toBe("source");
  }, 30_000);

  it("parses CSV uploads", async () => {
    const csv = Buffer.from("﻿policy_number,first_name\nPOL1,Ann\nPOL2,Ben\n");
    const parsed = await runCpuTask("parseSpreadsheet", { buffer: csv, fileName: "members.csv" });
    expect(parsed.headers).toEqual(["policy_number", "first_name"]);
    expect(parsed.rows).toEqual([
      { policy_number: "POL1", first_name: "Ann" },
      { policy_number: "POL2", first_name: "Ben" },
    ]);
  }, 30_000);

  it("parses Excel uploads", async () => {
    const parsed = await runCpuTask("parseSpreadsheet", { buffer: await buildWorkbook(3), fileName: "members.xlsx" });
    expect(parsed.headers).toEqual(["policy_number", "first_name", "amount"]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[2]).toEqual({ policy_number: "POL2", first_name: "Name 2", amount: "25.5" });
  }, 30_000);

  it("propagates task errors to the caller", async () => {
    await expect(
      runCpuTask("parseSpreadsheet", { buffer: Buffer.from("x"), fileName: "notes.txt" }),
    ).rejects.toThrow(/Unsupported file type: \.txt/);
  }, 30_000);

  it("returns binary results as Buffers", async () => {
    const pdf = await runCpuTask("smsReportPdf", {
      orgName: "Test Org", timezone: "Africa/Harare", periodLabel: "2026-09-01 to 2026-09-26",
      generatedBy: "tester", generatedAt: new Date().toISOString(), metered: false,
      tiles: [["Sent in period", "2"]],
      rows: [{
        createdAt: new Date().toISOString(), recipient: "+263771234567", clientName: "Ann",
        typeLabel: "Payment Receipted", status: "sent", statusLabel: "Sent", creditsCharged: 1,
        message: "Thank you", failureReason: null,
      }],
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("keeps the main event loop responsive while a large PDF renders", async () => {
    const rows = Array.from({ length: 4_000 }, (_, i) => ({
      createdAt: new Date().toISOString(), recipient: "+263771234567", clientName: `Client ${i}`,
      typeLabel: "Payment Receipted", status: i % 7 ? "sent" : "failed", statusLabel: "Sent", creditsCharged: 1,
      message: "Your premium of USD 25.00 was received. Thank you. ".repeat(2), failureReason: "timeout",
    }));
    await runCpuTask("threadInfo", {}); // make sure a worker is already warm
    let maxGap = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const pdf = await runCpuTask("smsReportPdf", {
      orgName: "Org", timezone: "Africa/Harare", periodLabel: "p", generatedBy: "t",
      generatedAt: new Date().toISOString(), metered: false, tiles: [["Sent", "4000"]], rows,
    });
    maxGap = Math.max(maxGap, Date.now() - last); // count a stall that lasted until the end
    clearInterval(timer);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Rendering this inline stalls the main thread for the whole render (seconds); on a worker
    // the 10ms timer keeps firing. Generous bound to stay stable on slow CI machines.
    expect(maxGap).toBeLessThan(400);
  }, 120_000);
});
