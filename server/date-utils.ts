/**
 * Zimbabwe is CAT = UTC+2, no DST. Any "what day is it" or "what time is it locally"
 * computation on the server must use these helpers instead of raw `Date`/`toISOString()`
 * arithmetic, which reflects the server's UTC clock and silently mis-attributes anything
 * that happens between 10pm and 2am CAT to the wrong calendar day.
 */

const HARARE_TZ = "Africa/Harare";

/** Today's date in Africa/Harare, as "YYYY-MM-DD". */
export function todayInHarare(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HARARE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Combines a "YYYY-MM-DD" date and "HH:MM" time, both interpreted as Africa/Harare wall-clock time, into the equivalent UTC instant. */
export function harareLocalToUtcDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+02:00`);
}
