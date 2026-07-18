import { apiJson } from "./client";

export interface DriveVehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string | null;
  status: string;
}

/** server/routes.ts:6056 — use:fleet. Vehicles free to check out right now. */
export async function getAvailableVehicles(): Promise<DriveVehicle[]> {
  return apiJson("/api/fleet/available");
}

export interface MyCheckout {
  id: string;
  vehicleId: string;
  driverId: string;
  startDate: string;
  notes: string | null;
  vehicle: DriveVehicle;
}

/** server/routes.ts:6063 — use:fleet. Null if the driver has nothing checked out;
 *  used to resume the trip screen after an app restart mid-trip. */
export async function getMyCheckout(): Promise<MyCheckout | null> {
  return apiJson("/api/fleet/checkouts/mine");
}

/** server/routes.ts:6083 — use:fleet. Server enforces clock-in-first and
 *  one-active-checkout-per-driver; both errors are surfaced to the caller
 *  as-is rather than pre-validated client-side, since the server is the
 *  only source of truth for attendance/checkout state. Returns the bare
 *  assignment record (no vehicle join) -- callers should refetch
 *  getMyCheckout() for the joined shape rather than rely on this response. */
export async function checkoutVehicle(vehicleId: string, notes?: string): Promise<{ id: string }> {
  return apiJson(`/api/fleet/${vehicleId}/checkout`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export async function returnMyVehicle(checkoutId: string): Promise<{ id: string }> {
  return apiJson(`/api/fleet/checkouts/${checkoutId}/return`, { method: "PATCH" });
}

export interface PingInput {
  latitude: number;
  longitude: number;
  speedKmh?: number;
  recordedAt: string;
}

/** server/routes.ts:6140 — use:fleet, own checkout only. Pings are batched
 *  client-side (see the trip screen's watchPositionAsync buffer) and flushed
 *  here periodically -- foreground-only, matching this app's location
 *  permission text ("does not track you in the background"); no
 *  background-location entitlement is requested anywhere in this app. */
export async function submitPings(checkoutId: string, pings: PingInput[]): Promise<void> {
  await apiJson(`/api/fleet/checkouts/${checkoutId}/pings`, {
    method: "POST",
    body: JSON.stringify({ pings }),
  });
}
