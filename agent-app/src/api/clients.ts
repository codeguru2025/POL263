import { apiJson } from "./client";

export interface Client {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isEnrolled: boolean;
  createdAt: string;
}

/** Server-side search (q) + agent-scoping (server/routes.ts:1740) — no client-side
 *  filtering needed, matches the leads.ts pattern. */
export async function getClients(q?: string): Promise<Client[]> {
  const params = new URLSearchParams({ limit: "500" });
  if (q) params.set("q", q);
  return apiJson(`/api/clients?${params}`);
}

export async function getClient(id: string): Promise<Client> {
  return apiJson(`/api/clients/${id}`);
}

export interface CreateClientInput {
  title?: string;
  firstName: string;
  lastName: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
}

export type CreateClientResult =
  | { kind: "created"; client: Client }
  | { kind: "existing"; client: Client; message: string };

/** POST /api/clients (server/routes.ts:1769) returns 200+EXISTING_CLIENT instead of
 *  blocking when the nationalId already matches a client — auto-population, not an error. */
export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const body = await apiJson<any>("/api/clients", { method: "POST", body: JSON.stringify(input) });
  if (body?.code === "EXISTING_CLIENT") {
    return { kind: "existing", client: body.existingClient, message: body.message };
  }
  return { kind: "created", client: body };
}
