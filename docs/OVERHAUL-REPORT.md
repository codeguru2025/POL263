# Codebase overhaul report

This document summarizes the overhaul done and remaining improvements identified from a full codebase review.

---

## Completed in this overhaul

### Error handling
- **client-search-input.tsx**: Check `res.ok` before `res.json()`; on failure or throw, set results to `[]` and keep dropdown open.
- **client/payments.tsx**: Status poll `queryFn` guards `currentIntent?.id` and checks `res.ok` before parsing; removed `currentIntent!` assertion.
- **join/register.tsx**: `res.json().catch(() => ({}))` so non-JSON error responses don’t throw; then check `res.ok` and show toast.
- **server/routes.ts**: Month-end run update `.catch(() => {})` replaced with logging via `structuredLog("warn", ...)` so failures are visible.

### Documentation
- **README.md**: Architecture & Tech Stack updated to Drizzle (not Prisma), real backend and shared schema, and TanStack Query.

---

## Recommended next steps (by priority)

### High impact
1. **Type safety**: Introduce `AuthenticatedRequest` and replace `req.user as any` in server routes; add shared API types (`shared/api-types.ts` or client `types/`) and use in staff/users, staff/settings, staff-layout.
2. **Input validation**: Add Zod validation to all mutable API routes (user create/update, policy create, claims transition, payments, etc.). Some routes already use `insert*Schema.parse(req.body)`; extend the pattern.
3. **Tests**: Align RBAC unit test with real permission names; add integration tests for auth and critical API paths; add E2E for agent login or mocked auth.

### Medium impact
4. **Security**: Move `PLATFORM_SUPERUSER_EMAIL` to env; document when to enable `ENABLE_CSRF_PROTECTION`; ensure no secrets in repo.
5. **Consistency**: Standardize on `apiRequest` (or one fetch wrapper) for all API calls; consider a shared `SearchInput` component and `uploadFile()` helper.
6. **Performance**: Add `useMemo` for expensive filtered/mapped lists where needed; consider lazy-loaded routes for reports/finance/products if bundle size grows.

### Lower impact
7. **Dead code**: Make `reducer` in `use-toast.ts` non-exported if not used elsewhere.
8. **JSDoc**: Add brief JSDoc to `requireAuth`, `requirePermission`, `requireTenantScope`, `apiRequest`, `getQueryFn`, and main storage methods.
9. **Dependencies**: Run `npm outdated` and `npm audit`; update README if any new env vars are required.

---

## Reference: areas scanned

- Dead code, type safety (`any`), error handling, consistency (naming, API usage, layout), security (secrets, CSRF, validation, XSS), performance (memoization, bundles, N+1), structure (duplication, shared types, API client), dependencies, tests, documentation.
