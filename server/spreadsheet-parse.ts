/**
 * Pure CSV / Excel parsing for the legacy-import tool. No DB or server-module imports — this runs
 * inside the CPU worker pool (server/cpu-pool.ts), so a 30,000-row workbook is parsed off the
 * main thread instead of freezing every other request for seconds.
 */
import { parse as parseCsvSync } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseSpreadsheetBuffer(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsvBuffer(buffer);
  if (ext === "xlsx" || ext === "xls") return parseExcelBuffer(buffer);
  throw new Error(`Unsupported file type: .${ext || "unknown"}. Upload a .csv or .xlsx file.`);
}

function parseCsvBuffer(buffer: Buffer): ParsedFile {
  const records = parseCsvSync(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

async function parseExcelBuffer(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const value = cellValueToString(row.getCell(idx + 1).value);
      if (value) hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  });

  return { headers: headers.filter(Boolean), rows };
}

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const asAny = value as any;
    if (typeof asAny.text === "string") return asAny.text;
    if (asAny.result != null) return String(asAny.result);
    if (asAny.richText) return asAny.richText.map((r: any) => r.text).join("");
  }
  return String(value);
}
