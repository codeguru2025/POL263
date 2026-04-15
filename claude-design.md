# POL263 staff UI redesign (layout & IA only)

This document describes the **administration shell redesign** inspired by classic policy-admin workflows (e.g. dense top navigation, grouped “Administration / Transactions / Reports / Tools” menus, global policy search, home hub tiles). It explicitly does **not** introduce a new colour theme: all surfaces use the **existing** `data-theme` tokens (`--background`, `--foreground`, `--primary`, `--card`, `--muted`, `--border`, etc.) from `client/src/index.css` and the active theme in `ThemeProvider` (default **POL263 (Teal)** / `insurance-teal`).

---

## 1. What we are copying vs not copying

| From reference UIs | In POL263 |
|--------------------|-----------|
| Top-of-app **identity strip** (org, user, time, tenant) | Yes — compact **utility bar** using `bg-card`, `border-b`, existing typography |
| **Horizontal primary nav** with grouped menus | Yes — `bg-primary` + `text-primary-foreground` so the bar **tracks the user’s theme** (teal, ocean, etc.), not fixed navy/gold |
| **Home** as a hub (tiles: messaging, help, services) | Yes — staff dashboard content area; links into real modules where they exist |
| **Global policy search** in the chrome | Yes — `PolicySearchInput`; selecting a policy navigates to `/staff/policies?openPolicy=<id>` |
| **Policy detail** accordions / quick links (change log, messaging) | Phase 2 — document here; optional follow-up in `policies.tsx` |
| **Gold header, navy chrome, easiPol palette** | **No** — no new `[data-theme="…"]` block and no hard-coded legacy colours for shell |

---

## 2. Information architecture (navigation)

Menus are **permission-filtered** the same way as today (empty permission list = visible to all authenticated staff for that item).

### 2.1 Control plane (platform owner, no tenant selected)

- **Home** → `/staff`
- **Tenants** → `/staff/settings?tab=tenants` (if `create:tenant`)
- **Settings** → `/staff/settings`

Mobile: single sheet listing the above.

### 2.2 Tenant workspace

- **Home** → `/staff`
- **Administration** (dropdown): policies, clients, claims, funerals, leads, groups, products, price book, users, tenants (if allowed), approvals (with badge)
- **Transactions** (dropdown): policies, funerals, finance, leads, payroll
- **Reports** → `/staff/reports` (when `read:report`)
- **Tools** (dropdown): asset register, audit, finance (billing), clients (CRM), notifications, diagnostics, settings, help, reminders, order-services

**Prefetch**: on hover/focus of menu links, reuse the same TanStack `prefetchQuery` keys as the previous sidebar (`/api/policies`, `/api/clients`, …).

---

## 3. Layout structure (`StaffLayout`)

1. **Utility bar** (`border-b bg-card`): logo / org name, tenant switcher (platform owner), branch label (read-only unless we add picker later), user display name, role, clock, `ThemeSwitcher`, compact policy search (tenant only).
2. **Primary nav** (`bg-primary text-primary-foreground border-b`): desktop = Home link + mega dropdowns + Reports link + Logout; mobile = hamburger opening a **Sheet** with grouped links (same sections as `mobileNavSections` in code).
3. **Main**: `flex-1 overflow-auto`, inner `max-w-[min(100%,1400px)] mx-auto` + responsive horizontal padding.
4. **Footer**: existing `AppFooter` for consistency with the rest of the product.

**Referral box** and **avatar** live in the mobile sheet footer and/or a small “Account” dropdown in the utility bar (to avoid losing features from the old sidebar).

---

## 4. Deep linking & search

- **Implementation**: `StaffLayout` sets `location` to `/staff/policies?openPolicy=<policyId>` when the user picks a row in `PolicySearchInput`.
- **Policies page**: `useSearch()` reads `openPolicy`; when the policy list is loaded and contains that id, open the detail view once and `setLocation("/staff/policies", { replace: true })` to avoid duplicate opens on refresh.

---

## 5. New stub routes (tools / hub parity)

Until full backend exists for legacy items, we add thin **staff** pages so links never 404:

| Route | Purpose |
|-------|---------|
| `/staff/help` | In-app help / links to training (static copy) |
| `/staff/reminders` | Lightweight reminders (e.g. `localStorage` MVP) |
| `/staff/order-services` | Placeholder for SMS/prepaid/VAS ordering (copy + link to Finance/Settings as appropriate) |
| `/staff/tools/assets` | Placeholder “asset register” checklist |

All use `StaffLayout` + existing `PageHeader` / `Card` patterns and **theme tokens only**.

---

## 6. Staff dashboard (home hub)

Replace or supplement the current KPI-first dashboard with a **hub row** aligned to the reference:

- **Messaging / notifications** → `/staff/notifications`
- **Help** → `/staff/help`
- **Rate experience** → optional dialog (thumbs) storing nothing or a future API
- **Footer links** → order-services, reminders

KPIs and charts can remain **below** the hub for power users.

---

## 7. Files touched (implementation checklist)

- [x] `claude-design.md` — this file  
- [x] `client/src/index.css` — no legacy-only theme block (shell uses tokens only)  
- [x] `client/src/components/theme-provider.tsx` — default `insurance-teal`; no easiPol palette theme  
- [x] `client/src/components/layout/staff-layout.tsx` — utility bar + `bg-primary` nav + sheet + policy search  
- [x] `client/src/App.tsx` — lazy routes for §5  
- [x] `client/src/pages/staff/help-center.tsx`, `reminders.tsx`, `order-services.tsx`, `assets-register.tsx`  
- [x] `client/src/pages/staff/policies.tsx` — `openPolicy` + optional fetch-by-id (§4)  
- [x] `client/src/pages/staff/dashboard.tsx` — hub section (§6)  

---

## 8. Out of scope (later phases)

- Client/agent portal reskin (only staff shell in this phase unless requested).
- Full SMS log API, receipt blocking, tombstone modules — document as product gaps; UI links can point to nearest existing page (e.g. audit, finance).
- Policy detail accordions — optional UX pass; data model already differs from legacy spouse/children split.

---

## 9. Acceptance criteria

- No new `[data-theme]` dedicated to “easiPol”; user can switch themes in **ThemeSwitcher** and the **entire** staff shell respects tokens.  
- Staff app builds with no missing symbols (`AppShell`, `navGroups`, `sidebarOpen`, etc.).  
- All new nav targets resolve (200) or redirect appropriately.  
- Policy search from header opens the correct policy detail.

---

## 10. App-wide chrome (`AppChrome`)

Public and **unauthenticated** flows use `client/src/components/layout/app-chrome.tsx`: same **utility header** (`bg-card`, POL263 home link or custom `headerStart`, **ThemeSwitcher**) and **AppFooter** as staff, with a centered or scrollable main area.

**Uses `AppChrome`:** `/` (home), 404, staff login, agent login, client login, client reset-password, client claim, join, join/register.

**Authenticated shells:** **Staff** — `staff-layout.tsx` (already aligned). **Client** — `client-layout.tsx` mirrors staff: utility bar + **`bg-primary` nav strip** + mobile sheet + **ThemeSwitcher** + same **`APP_SHELL_MAX`** content width as staff.
