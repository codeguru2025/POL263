/**
 * Roles whose presence in a user's role set overrides agent-level restrictions.
 * Any user who holds one of these roles in addition to "agent" receives the
 * broader access of their superior role, not the agent's scoped-down view.
 *
 * Criteria: the role must grant `view:all_clients` (see ROLE_PERMISSION_MAP in
 * server/constants.ts), which is the canonical gate for unrestricted data access.
 */
export const AGENT_SCOPE_OVERRIDE_ROLES = new Set([
  "superuser",
  "administrator",
  "manager",
]);

/**
 * Returns true when the user should be restricted to agent-scoped data access
 * (own clients/policies only, no cash payments, etc.).
 *
 * A user with the "agent" role AND a superior role (administrator, manager,
 * superuser) is treated as the superior role for data-scoping purposes so that
 * multi-role assignments work as expected.
 */
export function isAgentScoped(roles: { name: string }[]): boolean {
  const hasAgent = roles.some((r) => r.name === "agent");
  if (!hasAgent) return false;
  const hasSuperior = roles.some((r) => AGENT_SCOPE_OVERRIDE_ROLES.has(r.name));
  return !hasSuperior;
}
