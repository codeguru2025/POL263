# Security Policy - POL263

## Authentication
*   **Staff Portal**: Access is strictly limited to corporate Google Workspace accounts via OIDC. No local passwords are stored or accepted.
*   **Session Management**: Handled via secure, HttpOnly, SameSite cookies.
*   **Rate Limiting**: Applied strictly to auth endpoints to prevent enumeration or brute-force attempts.

## Authorization (RBAC & Tenancy)
*   **Tenant Isolation**: Every API request is verified against the user's allowed `organization_id` and `branch_id`. Row-level checks prevent cross-tenant data leakage.
*   **Server-Side Guards**: All sensitive operations are protected by permission-specific guards (e.g., `requiresPermission('write:lease')`).

## Audit Trail
*   All mutations (CREATE, UPDATE, DELETE) and sensitive READs generate an immutable audit log entry containing the user identity, timestamp, IP, and the exact data delta (before/after).

## Security Headers
*   Strict Content Security Policy (CSP) enforced.
*   CSRF protection mechanisms applied to all mutation endpoints.

## Superuser Provisioning
*   The initial superuser is provisioned via the `SUPERUSER_EMAIL` environment variable during deployment.
*   This email is NOT hardcoded in the source code. The seed script guarantees this user receives the `Superuser` role, and this assignment is explicitly logged in the audit trail.