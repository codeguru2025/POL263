import { cn } from "@/lib/utils";

export interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
