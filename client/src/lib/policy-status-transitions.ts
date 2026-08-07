export const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  inactive: ["cancelled"],
  active: ["grace", "cancelled"],
  grace: ["lapsed"],
  lapsed: ["cancelled"],
};

export const STATUS_LABELS: Record<string, string> = {
  inactive: "Inactive",
  active: "Active",
  grace: "Grace",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};
