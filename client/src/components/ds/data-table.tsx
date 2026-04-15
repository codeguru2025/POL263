import { cn } from "@/lib/utils";
import { Table } from "@/components/ui/table";

export interface DataTableProps {
  children: React.ReactNode;
  className?: string;
  /** Outer wrapper — default rounded container with subtle border. */
  containerClassName?: string;
}

/**
 * Scroll region + tabular numerals. Use sticky TableHeader rows inside children.
 */
export function DataTable({ children, className, containerClassName }: DataTableProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden",
        containerClassName,
      )}
    >
      <div className="overflow-x-auto max-w-full">
        <Table className={cn("tabular-nums text-sm", className)}>{children}</Table>
      </div>
    </div>
  );
}

/** Apply to `TableHeader` for sticky column headers inside scroll parents. */
export const dataTableStickyHeaderClass =
  "sticky top-0 z-10 bg-muted/95 backdrop-blur-sm border-b border-border/80 shadow-[0_1px_0_hsl(var(--border))]";
