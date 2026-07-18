# POL263 Client App

Expo (React Native) app for policyholders — view policies, pay premiums,
submit claims, and manage account details from the phone.

Third mobile app in this repo, alongside the removed Capacitor app and
`agent-app/` (agents + staff). Client auth is a completely different
mechanism from both of those — see below — so this is its own Expo project
rather than a role variant of `agent-app/`.

## Requires a custom dev client — not Expo Go

Uses `@preeternal/react-native-cookie-manager`, a native module Expo Go
can't load. You need a custom development build:

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
cd client-app
npm install
cp .env.example .env   # set EXPO_PUBLIC_API_BASE to your backend
npx expo start
```

## Auth

**Policy number + password** (`POST /api/client-auth/login`) — not email,
not OAuth. Verified directly against `server/client-auth.ts` before
building this, since an earlier assumption (email/OAuth) turned out to be
wrong. No org needs to be selected or known up front: login searches across
every tenant by policy number server-side
(`findAcrossOrgs`/`getPolicyByNumber`), so there's no pre-login branding to
show — the login screen uses the same neutral fallback branding as
`agent-app`'s pre-login screen.

First-time setup is a 3-step enrollment flow (`app/enroll.tsx`), matching
`client/src/pages/client/claim.tsx` on the web exactly:
1. Activation code + policy number → `POST /api/client-auth/claim`
2. Set password + pick a security question + answer it →
   `POST /api/client-auth/enroll`
3. Done — sign in.

Forgot password (`app/forgot-password.tsx`) asks for policy number +
security answer + new password in one step
(`POST /api/client-auth/reset-password`) — same as web, the question text
itself is never shown back to the user (they're expected to remember which
one they picked).

Session is a cookie, persisted the same way as `agent-app` (native cookie
manager + explicit flush after every request, since RN can't read
`Set-Cookie` headers). CSRF: `/api/client-auth/login` and `/logout` are
exempt; every other mutating call needs `X-XSRF-TOKEN`. There's no
client-specific CSRF token endpoint server-side — this app reuses
`GET /api/agent-auth/csrf-token`, confirmed safe because csurf ties the
token to the CSRF secret cookie, not to any particular auth type.

## Payments

Premium payments go through PayNow (`src/api/payments.ts`,
`app/(app)/payments.tsx`): create a payment intent, initiate with a method,
then poll for confirmation. Three methods are wired up:

- **EcoCash / OneMoney** — push a USSD prompt to the phone; the app just
  polls `GET .../status` and tells the user to check their phone.
- **Card (visa_mastercard)** — server returns a `redirectUrl`, opened in
  the system browser via `expo-web-browser`'s `openBrowserAsync`; the app
  resumes polling once the browser closes.

**Deliberately not wired up**: InnBucks (shows a one-time code with a
countdown timer — a distinct UI, not a form field) and O'Mari (needs an
OTP-submit round trip). Both are real endpoints
(`POST .../initiate` returns `innbucksCode`/`needsOtp`) but are separate
screens' worth of work, left for a later pass rather than half-built.

## Deliberately deferred (not in this pass)

- **Policy document / receipt PDF viewing** — the download endpoints are
  session-cookie-gated, so `Linking.openURL` would just 401 in an external
  browser. Doing this properly needs an authenticated in-app fetch +
  `expo-file-system` write + `expo-sharing`/open-sheet — a real feature,
  not a one-line addition.
- **Documents screen** (client-uploaded ID/proof-of-residence) — same PDF
  problem, lower priority than payments/claims.
- **Group executive features** (pay for group members, group receipts) —
  `/api/client-auth/my-groups`, `/group/:id/policies`, `/group-receipt`
  exist server-side, unused here.
- **Pay-for-someone-else** (`/api/client-auth/lookup-by-phone`) — the web
  app supports looking up another client by phone/policy/national ID to
  pay their premium; not in this pass.
- **Dependents management** — `/api/client-auth/dependents` CRUD exists,
  unused; beneficiary appointment currently only supports typing a new
  beneficiary, not picking an existing dependent.
- **Notifications, credit notes, receipts list** — endpoints exist
  (`/notifications`, `/credit-notes`, `/receipts`), no screens yet.
- **Push notification registration** — `/register-device` exists;
  wiring up `expo-notifications` is a separate pass.

## Architecture

```
client-app/
├── app/
│   ├── _layout.tsx                # AuthProvider + Stack.Protected auth gate
│   ├── login.tsx                  # Policy number + password
│   ├── enroll.tsx                 # 3-step first-time activation
│   ├── forgot-password.tsx        # Security-question password reset
│   └── (app)/
│       ├── _layout.tsx            # Tabs: Home, Payments, Claims, More
│       ├── index.tsx              # Policy list + detail (balance, members, beneficiary)
│       ├── payments.tsx           # PayNow premium payment flow
│       ├── claims.tsx             # Claims list + submit
│       └── more.tsx               # Profile, change password, feedback, sign out
└── src/
    ├── config.ts                  # API_BASE, deep-link scheme (pol263client)
    ├── api/
    │   ├── client.ts              # fetch wrapper, CSRF, cookie persistence
    │   ├── auth.ts                # login/enroll/reset/me
    │   ├── branding.ts            # pre-login neutral branding
    │   ├── policies.ts, claims.ts, payments.ts, feedback.ts
    └── context/AuthContext.tsx    # session state
```

## Verified so far

`npx tsc --noEmit`, `npx expo export`, and `npx expo-doctor` all pass
clean. **Not yet verified**: an actual login/enrollment round-trip, a real
PayNow payment, or cookie persistence across a real app restart — this
environment has no Android SDK/emulator to run one.
