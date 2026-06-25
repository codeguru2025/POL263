export function structuredLog(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  if (__DEV__) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level.toUpperCase()}] ${message}`, data ?? "");
  }
}
