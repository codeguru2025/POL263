import { cn } from "@/lib/utils";

export interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

/** Standard vertical rhythm for page content inside StaffLayout / ClientLayout. */
export function PageShell({ children, className }: PageShellProps) {
  return <div className={cn("flex flex-col gap-6 min-w-0 w-full", className)}>{children}</div>;
}
