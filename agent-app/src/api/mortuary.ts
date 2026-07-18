import { apiJson } from "./client";

export interface MortuaryIntake {
  id: string;
  intakeNumber: string;
  serviceScope: string;
  status: string;
  deceasedName: string;
  deceasedGender: string | null;
  deceasedAge: number | null;
  dateOfDeath: string | null;
  placeOfDeath: string | null;
  removalLocation: string | null;
  removalDateTime: string | null;
  receivedAt: string | null;
  notes: string | null;
  partnerParlourId: string | null;
  storageCategory: string | null;
  storageFeeStatus: string | null;
  createdAt: string;
}

/** server/routes.ts:5658 — read:funeral_ops. Intake creation, edit, dispatch,
 *  and fee payment stay web-only in this pass: they're office/admin tasks
 *  (linking a funeral case, releasing a body, recording payment) rather than
 *  the on-site attendant work this screen targets, matching the earlier
 *  staff-exclusion reasoning applied elsewhere in this app. */
export async function getMortuaryIntakes(status?: string): Promise<MortuaryIntake[]> {
  const params = status ? `?status=${status}` : "";
  return apiJson(`/api/mortuary-intakes${params}`);
}

export async function getMortuaryIntake(id: string): Promise<MortuaryIntake> {
  return apiJson(`/api/mortuary-intakes/${id}`);
}

export interface BodyWashRequirement {
  id: string;
  intakeId: string;
  clothesProvided: boolean;
  blanketProvided: boolean;
  wreathProvided: boolean;
  otherItems: string | null;
  washedByName: string | null;
  completedAt: string | null;
}

export async function getBodyWash(intakeId: string): Promise<BodyWashRequirement | null> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/body-wash`);
}

export interface BodyWashInput {
  clothesProvided: boolean;
  blanketProvided: boolean;
  wreathProvided: boolean;
  otherItems?: string;
  washedByName?: string;
  markCompleted: boolean;
}

/** server/routes.ts:5963 — upsert (one row per intake), write:funeral_ops. */
export async function saveBodyWash(intakeId: string, input: BodyWashInput): Promise<BodyWashRequirement> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/body-wash`, {
    method: "POST",
    body: JSON.stringify({
      clothesProvided: input.clothesProvided,
      blanketProvided: input.blanketProvided,
      wreathProvided: input.wreathProvided,
      otherItems: input.otherItems || undefined,
      washedByName: input.washedByName || undefined,
      completedAt: input.markCompleted ? new Date().toISOString() : undefined,
    }),
  });
}

export interface Belonging {
  id: string;
  intakeId: string;
  itemDescription: string;
  quantity: number;
  submittedByName: string | null;
  notes: string | null;
  createdAt: string;
}

export async function getBelongings(intakeId: string): Promise<Belonging[]> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/belongings`);
}

export async function addBelonging(intakeId: string, itemDescription: string, quantity: number, submittedByName?: string): Promise<Belonging> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/belongings`, {
    method: "POST",
    body: JSON.stringify({ itemDescription, quantity, submittedByName: submittedByName || undefined }),
  });
}

export interface PostMortemMovement {
  id: string;
  intakeId: string;
  takenOutAt: string;
  takenToLocation: string | null;
  authorizedBy: string | null;
  collectedByName: string | null;
  returnedAt: string | null;
  notes: string | null;
}

export async function getPostMortemMovements(intakeId: string): Promise<PostMortemMovement[]> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/post-mortem`);
}

/** server/routes.ts:5859 — server rejects if the intake is already out or
 *  already dispatched; surfaced verbatim, not pre-checked client-side. */
export async function recordPostMortemOut(intakeId: string, takenToLocation: string, authorizedBy?: string, collectedByName?: string): Promise<PostMortemMovement> {
  return apiJson(`/api/mortuary-intakes/${intakeId}/post-mortem`, {
    method: "POST",
    body: JSON.stringify({ takenToLocation, authorizedBy: authorizedBy || undefined, collectedByName: collectedByName || undefined }),
  });
}

export async function recordPostMortemReturn(movementId: string): Promise<PostMortemMovement> {
  return apiJson(`/api/post-mortem-movements/${movementId}/return`, { method: "POST" });
}
