# Security Policy

## Authentication
- **Staff Access**: Strictly limited to Google OAuth/OIDC. No local password authentication is permitted for staff accounts to prevent credential stuffing and enforce MFA via the IdP.
- **Session Management**: Secure, HTTP-only, SameSite cookies with strict expiration.

## Authorization (RBAC)
- All staff API routes are guarded by a centralized RBAC middleware.
- Row-level security checks ensure users can only access data within their assigned Tenant (Organization) and Branch.

## Infrastructure Security
- Strict Content Security Policy (CSP).
- Rate limiting on all authentication and high-value endpoints.
- CSRF protection enabled.