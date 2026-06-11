/**
 * Pure, framework-free helpers for the EnhancedDataTable (Phase 5 table
 * standards). Kept separate so the search/sort/CSV logic is unit-testable
 * without rendering. See tests/unit/table-utils.test.ts.
 */

export type SortDir = "asc" | "desc";

/** Coerce any cell value to a stable, comparable/searchable string. */
export function toText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

/** Case-insensitive substring filter across the provided accessors. */
export function filterRows<T>(rows: T[], query: string, accessors: ((row: T) => unknown)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    accessors.some((get) => toText(get(row)).toLowerCase().includes(q)),
  );
}

/** Stable sort by a single accessor. Numbers compare numerically, else by text. */
export function sortRows<T>(rows: T[], accessor: (row: T) => unknown, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => [row, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const va = accessor(a);
      const vb = accessor(b);
      const na = typeof va === "number" ? va : Number(va);
      const nb = typeof vb === "number" ? vb : Number(vb);
      let cmp: number;
      if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== "" && vb !== "") {
        cmp = na - nb;
      } else {
        cmp = toText(va).localeCompare(toText(vb), undefined, { sensitivity: "base" });
      }
      return cmp !== 0 ? cmp * sign : ai - bi; // stable tiebreak on original index
    })
    .map(([row]) => row);
}

/** Escape a single CSV field per RFC 4180. */
export function csvCell(value: unknown): string {
  const s = toText(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from rows + column definitions. */
export function rowsToCsv<T>(
  rows: T[],
  columns: { header: string; value: (row: T) => unknown }[],
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

/** Trigger a browser download of a CSV string. No-op outside the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
