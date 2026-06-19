import { useSyncExternalStore } from "react";

/**
 * Minimal, additive feature-flag system for the POL263 UX transformation.
 *
 * - Defaults live here (the "shipped" state).
 * - Any flag can be overridden per-browser via localStorage key `pol263.flags`
 *   (a JSON object of `{ flagName: boolean }`), which acts as an instant kill
 *   switch / opt-in without a redeploy.
 * - No server state, no schema change. Disabling a flag fully reverts to the
 *   prior behaviour (see docs/POL263-TRANSFORMATION-PLAN.md Part H/J).
 *
 * To revert the entire new experience from the browser console:
 *   localStorage.setItem('pol263.flags', JSON.stringify({ newNav:false, globalSearch:false, commandPalette:false, quickCreate:false, commandCenters:false }))
 */
export type FlagName =
  | "newNav"
  | "globalSearch"
  | "commandPalette"
  | "quickCreate"
  | "commandCenters"
  | "receiptDrawer"
  | "policyWizard";

const DEFAULTS: Record<FlagName, boolean> = {
  newNav: true,
  globalSearch: true,
  commandPalette: true,
  quickCreate: true,
  commandCenters: true,
  receiptDrawer: true,
  policyWizard: true,
};

const STORAGE_KEY = "pol263.flags";

function readOverrides(): Partial<Record<FlagName, boolean>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getFlag(name: FlagName): boolean {
  const overrides = readOverrides();
  return name in overrides ? !!overrides[name] : DEFAULTS[name];
}

/** Imperative setter (also used by a future Setup toggle UI). */
export function setFlag(name: FlagName, value: boolean): void {
  if (typeof window === "undefined") return;
  const overrides = readOverrides();
  overrides[name] = value;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new Event("pol263:flags"));
}

// ── React binding ────────────────────────────────────────────────────────
function subscribe(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener("pol263:flags", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("pol263:flags", handler);
    window.removeEventListener("storage", handler);
  };
}

export function useFlag(name: FlagName): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getFlag(name),
    () => DEFAULTS[name],
  );
}
