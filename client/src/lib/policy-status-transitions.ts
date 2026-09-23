export const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  inactive: ["cancelled", "archived"],
  active: ["grace", "cancelled"],
  grace: ["lapsed"],
  lapsed: ["cancelled", "archived"],
  cancelled: ["active"],
  archived: ["active"],
};

export const STATUS_LABELS: Record<string, string> = {
  inactive: "Inactive",
  active: "Active",
  grace: "Grace",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  archived: "Archived",
};
