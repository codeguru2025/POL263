// Brand: deep teal primary — unified with the web staff portal and all
// generated PDF documents (policy schedule, receipts, funeral notification)
// for a consistent traditional-assurance corporate identity.
export const colors = {
  primary: "#0f766e",      // teal-700 (matches web --primary)
  primaryLight: "#149488",
  primaryDark: "#0b5953",
  accent: "#0f766e",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  background: "#f6f8f8",
  surface: "#ffffff",
  surfaceAlt: "#f1f5f4",
  text: "#111c1a",
  textSecondary: "#566461",
  textMuted: "#8a9794",
  border: "#dde5e3",
  borderLight: "#eef2f1",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Squared, document-like corners for a formal ledger feel.
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
};

/** Formal uppercase section eyebrow style (use spread into a Text style). */
export const sectionLabel = {
  fontSize: 11,
  fontWeight: "700" as const,
  letterSpacing: 0.8,
  textTransform: "uppercase" as const,
  color: colors.textMuted,
};
