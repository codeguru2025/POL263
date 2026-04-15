import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SkeletonLoader({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-md", className)} />;
}

export function SkeletonTableRows({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, ri) => (
        <tr key={ri} className="border-b border-border/40">
          {Array.from({ length: cols }).map((_, ci) => (
            <td key={ci} className="p-3">
              <Skeleton className="h-4 w-full max-w-[8rem] rounded" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
