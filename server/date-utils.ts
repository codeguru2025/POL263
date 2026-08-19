/**
 * Any "what day is it" or "what time is it locally" computation on the server must use these
 * helpers instead of raw `Date`/`toISOString()` arithmetic, which reflects the server's UTC
 * clock and silently mis-attributes anything that happens near local midnight to the wrong
 * calendar day. Each tenant has its own IANA timezone (organizations.timezone, defaults to
 * "Africa/Harare" — CAT, UTC+2, no DST — for backward compatibility with every org that existed
 * before this was configurable).
 *
 * Deliberately uses `Intl.DateTimeFormat` with an explicit `timeZone`, never a fixed UTC offset:
 * a fixed offset (e.g. "+02:00") is only safe for Harare, which has no DST. A tenant in a
 * DST-observing zone would get a silently wrong hour for roughly half the year with a fixed
 * offset.
 */

const DEFAULT_TZ = "Africa/Harare";

/** Today's date in the given IANA timezone, as "YYYY-MM-DD". */
export function todayInTimezone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || DEFAULT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Combines a "YYYY-MM-DD" date and "HH:MM" time, both interpreted as wall-clock time in `tz`,
 * into the equivalent UTC instant. Computes the zone's actual UTC offset for that specific date
 * (via Intl, not a hardcoded constant) so DST-observing zones resolve correctly for the season.
 */
export function localToUtcDate(dateStr: string, timeStr: string, tz: string): Date {
  const zone = tz || DEFAULT_TZ;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  // First guess: treat the wall-clock components as if they were UTC, then measure how far that
  // guess's rendering in `zone` differs from the intended wall-clock time, and correct for it.
  // This converges in one step for all real-world zones (whole-number-of-minutes offsets).
  const guessUtc = Date.UTC(y, m - 1, d, hh, mm);
  const rendered = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guessUtc));
  const parts: Record<string, number> = {};
  for (const p of rendered) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const renderedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsetMs = guessUtc - renderedUtc;
  return new Date(guessUtc + offsetMs);
}

// ─── Per-org timezone lookup, cached ────────────────────────────────────────
// Same short-TTL in-memory cache shape as the module-flag cache (server/module-gate.ts) — cheap,
// per-process, fine to go briefly stale after a settings change.
const TZ_CACHE_TTL_MS = 30_000;
const tzCache = new Map<string, { tz: string; at: number }>();

/** Looks up an org's configured timezone, cached for 30s. Falls back to Africa/Harare if the org
 *  can't be found (should not happen in practice — orgId always comes from an authenticated
 *  session/tenant-scoped job) rather than throwing, since this only ever feeds a date computation.
 *  Goes through storage.getOrganization() (a dynamic import — storage.ts itself imports
 *  todayForOrg from this file, so a static import here would be circular) rather than querying
 *  `organizations` directly, per this codebase's "all DB ops go through server/storage.ts"
 *  convention (see CLAUDE.md) — date-utils.ts otherwise has zero DB dependency of its own. */
export async function getOrgTimezone(orgId: string): Promise<string> {
  const cached = tzCache.get(orgId);
  if (cached && Date.now() - cached.at < TZ_CACHE_TTL_MS) return cached.tz;
  const { storage } = await import("./storage");
  const org = await storage.getOrganization(orgId);
  const tz = (org as any)?.timezone || DEFAULT_TZ;
  tzCache.set(orgId, { tz, at: Date.now() });
  return tz;
}

/** Convenience: today's date in an org's configured timezone, as "YYYY-MM-DD". */
export async function todayForOrg(orgId: string): Promise<string> {
  return todayInTimezone(await getOrgTimezone(orgId));
}
