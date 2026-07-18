import { apiJson } from "./client";

export interface Vehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string | null;
  status: string;
  currentMileage: number | null;
  speedLimitKmh: number;
}

/** server/routes.ts:6002 — read:fleet. This screen is the staff/manager fleet
 *  overview, not the driver self-checkout flow (that's the "Drivers" mobile
 *  persona planned for a later pass, using use:fleet + GPS ping submission). */
export async function getVehicles(): Promise<Vehicle[]> {
  return apiJson("/api/fleet?limit=500");
}

export interface VehiclePing {
  id: string;
  latitude: string;
  longitude: string;
  speedKmh: string | null;
  recordedAt: string;
}

export interface ActiveCheckout {
  id: string;
  vehicleId: string;
  driverId: string;
  startDate: string;
  notes: string | null;
  latestPing: VehiclePing | null;
}

/** server/routes.ts:6072 — read:fleet. Dispatcher-style "who has what, since
 *  when, where were they last seen" view -- no live map in this pass (that's
 *  the dedicated "dispatcher map" mobile persona), just the latest coordinate
 *  as text. */
export async function getActiveCheckouts(): Promise<ActiveCheckout[]> {
  return apiJson("/api/fleet/checkouts/active");
}

/** Manager override return -- server/routes.ts:6120 allows either the driver
 *  themselves or a write:fleet holder to end a checkout; this screen is the
 *  write:fleet path. */
export async function returnVehicle(checkoutId: string): Promise<ActiveCheckout> {
  return apiJson(`/api/fleet/checkouts/${checkoutId}/return`, { method: "PATCH" });
}
