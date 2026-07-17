# POL263 Agent + Staff App

Expo (React Native) app for insurance agents and staff — bootstrap milestone.
Covers real authentication against the live backend and role-resolved
navigation. Screen-by-screen features (leads, policies, clients, attendance,
etc.) are placeholders for now — see the build spec artifact from planning
for the full feature scope and deliberate deviations from the web app.

## Requires a custom dev client — not Expo Go

This app uses `@preeternal/react-native-cookie-manager`, a native module that
plain Expo Go can't load (Expo Go only bundles Expo's own SDK modules). You
need a custom development build:

```bash
# Local (needs Android Studio / SDK installed)
npx expo run:android

# Or via Expo's cloud build service (no local Android SDK needed)
npm install -g eas-cli
eas login
eas build --profile development --platform android
```

## Setup

```bash
cd agent-app
npm install
```

Set `EXPO_PUBLIC_API_BASE` (see `src/config.ts`) to point at your backend —
defaults to this machine's LAN dev server. There's no same-origin fallback
like the web app has; this must always point at a real API base.

```bash
npx expo start
```

## Auth

Two login paths, matching the backend exactly (`server/auth.ts`):

- **Agent** — email + password via `POST /api/agent-auth/login`. Plain JSON
  request/response, cookie session set on success.
- **Staff** — Google OAuth. Opens the system browser
  (`expo-web-browser`'s `openAuthSessionAsync`) at
  `GET /api/auth/google?returnTo=mobile`, which redirects back to
  `pol263://auth/callback?token=...` on success. The token is exchanged for
  a real session via `POST /api/auth/mobile-exchange` (single-use, 5-minute
  expiry — same mechanism the old Capacitor app used).

Session is a cookie (`connect.sid`), not a JWT — none exists in this
codebase and the backend doesn't need one. React Native's `fetch` can't read
`Set-Cookie` response headers (a long-standing RN limitation), so
`src/api/client.ts` uses `@preeternal/react-native-cookie-manager` to
explicitly flush the session cookie to native storage after every request,
so it survives an app restart rather than relying on implicit behavior that's
documented as unreliable (especially on iOS).

CSRF: `/api/agent-auth/login` is exempt, but every other mutating request
needs an `X-XSRF-TOKEN` header — fetched once from
`GET /api/agent-auth/csrf-token` and cached, with an automatic refresh-and-retry
on a stale-token 403.

## Architecture

```
agent-app/
├── app/                          # Expo Router — file-based routing
│   ├── _layout.tsx               # AuthProvider + Stack.Protected auth gate
│   ├── login.tsx                 # Agent/staff login (tabbed)
│   └── (app)/                    # Authenticated area
│       ├── _layout.tsx           # Role-resolved Tabs (agent vs staff tab set)
│       ├── index.tsx             # Home — real per-org branding
│       ├── leads.tsx, policies.tsx, clients.tsx   # agent-only (placeholder)
│       ├── approvals.tsx, fleet.tsx               # staff-only (placeholder)
│       ├── attendance.tsx                         # shared (placeholder)
│       └── more.tsx              # Sign out
└── src/
    ├── config.ts                 # API_BASE, deep-link scheme
    ├── api/
    │   ├── client.ts             # fetch wrapper, CSRF, cookie persistence
    │   ├── auth.ts                # login/logout/me
    │   └── branding.ts           # per-tenant branding fetch
    ├── context/AuthContext.tsx   # session state, isAgent role resolution
    └── components/PlaceholderScreen.tsx
```

## Verified so far

`npx tsc --noEmit`, `npx expo export`, and `npx expo-doctor` all pass clean.
**Not yet verified**: an actual login round-trip, cookie persistence across a
real app restart, or the OAuth deep-link handoff on a device — this
environment has no Android SDK/emulator to run one. That's the next real
test once you have a dev client build running.
