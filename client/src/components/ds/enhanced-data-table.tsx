import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { DataTable, dataTableStickyHeaderClass } from "./data-table";
import { EmptyState } from "./empty-state";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Download, SlidersHorizontal } from "lucide-react";
import { filterRows, sortRows, rowsToCsv, downloadCsv, toText, type SortDir } from "@/lib/table-utils";

export interface EdtColumn<T> {
  id: string;
  header: string;
  /** Custom cell renderer. Defaults to the text of `accessor`. */
  cell?: (row: T) => React.ReactNode;
  /** Value used for search, sort and CSV export. Omit for action/render-only columns. */
  accessor?: (row: T) => unknown;
  sortable?: boolean;
  exportable?: boolean;
  defaultHidden?: boolean;
  align?: "left" | "right";
  headClassName?: string;
  cellClassName?: string;
}

export interface EnhancedDataTableProps<T> {
  columns: EdtColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  exportable?: boolean;
  exportFilename?: string;
  /** Persists column visibility + sort per-browser. */
  storageKey?: string;
  emptyMessage?: string;
  rowTestId?: (row: T) => string;
  toolbarExtra?: React.ReactNode;
  onRowClick?: (row: T) => void;
}

interface PersistShape {
  hidden?: string[];
  sortId?: string | null;
  sortDir?: SortDir;
}

function loadPersist(key?: string): PersistShape {
  if (!key || typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(`pol263.table.${key}`) || "{}");
  } catch {
    return {};
  }
}

/**
 * Data-driven table implementing the Phase-5 table standards: search, sortable
 * columns, CSV export, column chooser and per-browser saved views. Additive —
 * existing presentational `DataTable` usages are unaffected.
 */
export function EnhancedDataTable<T>({
  columns,
  rows,
  getRowKey,
  searchable = true,
  searchPlaceholder = "Search…",
  exportable = true,
  exportFilename = "export",
  storageKey,
  emptyMessage = "No records found.",
  rowTestId,
  toolbarExtra,
  onRowClick,
}: EnhancedDataTableProps<T>) {
  const persisted = useMemo(() => loadPersist(storageKey), [storageKey]);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(persisted.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.id)),
  );
  const [sortId, setSortId] = useState<string | null>(persisted.sortId ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(persisted.sortDir ?? "asc");

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    window.localStorage.setItem(
      `pol263.table.${storageKey}`,
      JSON.stringify({ hidden: Array.from(hidden), sortId, sortDir } satisfies PersistShape),
    );
  }, [storageKey, hidden, sortId, sortDir]);

  const visibleColumns = columns.filter((c) => !hidden.has(c.id));
  const searchAccessors = columns.filter((c) => c.accessor).map((c) => c.accessor!) as ((row: T) => unknown)[];

  const processed = useMemo(() => {
    let out = searchable ? filterRows(rows, query, searchAccessors) : rows;
    if (sortId) {
      const col = columns.find((c) => c.id === sortId);
      if (col?.accessor) out = sortRows(out, col.accessor, sortDir);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sortId, sortDir, searchable]);

  const toggleSort = (col: EdtColumn<T>) => {
    if (!col.accessor || col.sortable === false) return;
    if (sortId !== col.id) {
      setSortId(col.id);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortId(null);
    }
  };

  const exportCsv = () => {
    const cols = columns
      .filter((c) => c.accessor && c.exportable !== false)
      .map((c) => ({ header: c.header, value: c.accessor! }));
    downloadCsv(exportFilename, rowsToCsv(processed, cols));
  };

  const canExport = exportable && columns.some((c) => c.accessor && c.exportable !== false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 h-9"
              data-testid="edt-search"
            />
          </div>
        )}
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">{processed.length} of {rows.length}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" data-testid="edt-columns">
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hidden.has(c.id)}
                  onCheckedChange={(checked) =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                >
                  {c.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canExport && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} data-testid="edt-export">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
        </div>
      </div>

      {processed.length === 0 ? (
        <EmptyState title={emptyMessage} description={query ? "Try a different search." : undefined} />
      ) : (
        <DataTable>
          <TableHeader className={dataTableStickyHeaderClass}>
            <TableRow>
              {visibleColumns.map((c) => {
                const sortable = !!c.accessor && c.sortable !== false;
                return (
                  <TableHead
                    key={c.id}
                    className={cn(c.align === "right" && "text-right", sortable && "cursor-pointer select-none", c.headClassName)}
                    onClick={sortable ? () => toggleSort(c) : undefined}
                    tabIndex={sortable ? 0 : undefined}
                    aria-sort={sortable ? (sortId === c.id ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    onKeyDown={sortable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(c); } } : undefined}
                  >
                    <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      {sortable &&
                        (sortId === c.id ? (
                          sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        ))}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {processed.map((row) => (
              <TableRow
                key={getRowKey(row)}
                data-testid={rowTestId?.(row)}
                className={onRowClick ? "hover:bg-muted/30 transition-colors cursor-pointer" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } : undefined}
              >
                {visibleColumns.map((c) => (
                  <TableCell key={c.id} className={cn(c.align === "right" && "text-right", c.cellClassName)}>
                    {c.cell ? c.cell(row) : toText(c.accessor?.(row))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      )}
    </div>
  );
}
