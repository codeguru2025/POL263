import { describe, it, expect } from "vitest";
import { toText, filterRows, sortRows, csvCell, rowsToCsv } from "../../client/src/lib/table-utils";

interface Row { name: string; amount: number; status: string }
const rows: Row[] = [
  { name: "Bravo", amount: 30, status: "active" },
  { name: "alpha", amount: 200, status: "lapsed" },
  { name: "Charlie", amount: 5, status: "active" },
];

describe("toText", () => {
  it("handles null/undefined as empty string", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
  });
  it("stringifies primitives and objects", () => {
    expect(toText(42)).toBe("42");
    expect(toText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("filterRows", () => {
  const get = [(r: Row) => r.name, (r: Row) => r.status];
  it("returns all rows for empty query", () => {
    expect(filterRows(rows, "  ", get)).toHaveLength(3);
  });
  it("is case-insensitive and matches across accessors", () => {
    expect(filterRows(rows, "ALPHA", get).map((r) => r.name)).toEqual(["alpha"]);
    expect(filterRows(rows, "active", get)).toHaveLength(2);
  });
  it("returns empty when nothing matches", () => {
    expect(filterRows(rows, "zzz", get)).toHaveLength(0);
  });
});

describe("sortRows", () => {
  it("sorts numerically asc/desc", () => {
    expect(sortRows(rows, (r) => r.amount, "asc").map((r) => r.amount)).toEqual([5, 30, 200]);
    expect(sortRows(rows, (r) => r.amount, "desc").map((r) => r.amount)).toEqual([200, 30, 5]);
  });
  it("sorts text case-insensitively", () => {
    expect(sortRows(rows, (r) => r.name, "asc").map((r) => r.name)).toEqual(["alpha", "Bravo", "Charlie"]);
  });
  it("is stable for equal keys", () => {
    const eq = [{ id: 1, k: "x" }, { id: 2, k: "x" }, { id: 3, k: "x" }];
    expect(sortRows(eq, (r) => r.k, "asc").map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("csvCell / rowsToCsv", () => {
  it("quotes fields with commas, quotes, or newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("builds a header + body CSV", () => {
    const csv = rowsToCsv(rows.slice(0, 1), [
      { header: "Name", value: (r) => r.name },
      { header: "Amount", value: (r) => r.amount },
    ]);
    expect(csv).toBe("Name,Amount\r\nBravo,30");
  });
  it("returns just the header for no rows", () => {
    expect(rowsToCsv([] as Row[], [{ header: "Name", value: (r) => r.name }])).toBe("Name");
  });
});
