# Web + Mobile from a Single Codebase

Yes — you can run the same app as a **web app** and a **mobile app**, with one codebase so that changes apply to both.

---

## How it works

- **Backend:** One API (this repo’s Express server). Both web and mobile use the same endpoints; no backend duplication.
- **Frontend:** One React app (the `client/` folder). You have two ways to get it on mobile:

| Approach | Single codebase? | Effort | Result |
|----------|------------------|--------|--------|
| **Hybrid (Capacitor)** | ✅ Yes — same React app | Low | Web app runs inside a native shell on iOS/Android. One codebase; one set of changes. |
| **React Native + Web** | ✅ Yes — but different UI layer | High | Separate React Native app that also targets web via react-native-web. More native look/feel, bigger refactor. |

**Recommendation:** Use **Capacitor** so your existing React + Vite app is also the mobile app. One codebase, one UI, one deployment story.

---

## What’s in this repo (Capacitor path)

- **Web:** Unchanged. Build and serve as you do today (`npm run build`, `npm start`, or your host).
- **Mobile:** Capacitor wraps the **same built web app** in a native iOS/Android shell. You build the web app once (`npm run build`), then run `npx cap sync` and open the native project in Xcode or Android Studio to build and run on device/simulator.

When you change React code and rebuild:

1. Run `npm run build`.
2. Run `npx cap sync` (copies `dist/public` into the native projects).
3. Run or archive the app from Xcode/Android Studio (or use `npx cap run ios` / `npx cap run android`).

So: **one codebase, one build of the client, web + mobile.**

---

## Quick start (Capacitor)

1. **Install dependencies** (if not already):
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap add ios
   npx cap add android
   ```
   (You need Xcode for iOS and Android Studio / SDK for Android.)

2. **Build the web app:**
   ```bash
   npm run build
   ```

3. **Sync the built app into the native projects:**
   ```bash
   npx cap sync
   ```

4. **Open and run:**
   ```bash
   npx cap open ios
   # or
   npx cap open android
   ```

Use the scripts in `package.json`: `build:web`, `cap:sync`, `cap:ios`, `cap:android` (see below).

---

## API base URL on mobile

- **Web:** The app is often served from the same origin as the API (e.g. `/api/...`), so relative URLs work.
- **Mobile (Capacitor):** The app is loaded from `file://` or a local server, so you must point requests to your **real API host**.

**Option A — Build-time base URL (recommended for production):**  
Set an environment variable the client reads at build time:

- **Production mobile build:** `VITE_API_BASE=https://api.yourdomain.com`
- **Web or same-origin:** Leave `VITE_API_BASE` unset.

Build for mobile with the API base set, then sync:

```bash
VITE_API_BASE=https://api.yourdomain.com npm run build
npx cap sync
```

The client uses `getApiBase()` in `client/src/lib/queryClient.ts` for all React Query and `apiRequest()` calls. Any direct `fetch("/api/...")` in the codebase should use `getApiBase() + "/api/..."` so mobile builds hit the correct host. (Staff login redirect, join page agent lookup, reports export, policies/clients fetch, and upload already use `getApiBase()`.)

**Note:** Report CSV export uses `window.open(getApiBase() + url)`. If the API is on a different origin, that new window may not send cookies; for authenticated export you may need to host the app and API on the same origin or implement a fetch-with-credentials + blob download instead.

**Option B — Load app from your server:**  
Host the built web app (e.g. from `dist/public`) on the same server as your API. In `capacitor.config.ts`, set `server.url` to that origin (e.g. `https://app.yourdomain.com`). The WebView then loads the app from your server and relative URLs work without `VITE_API_BASE`.

---

## Optional: mobile-specific tweaks

From the same codebase you can still adjust behavior per platform:

- **Capacitor:** Use `import { Capacitor } from '@capacitor/core'` and `Capacitor.getPlatform()` (`'ios' | 'android' | 'web'`) to branch logic or layout (e.g. safe area, back button, status bar).
- **CSS:** Use responsive layout and touch-friendly targets so the same React/Tailwind UI works on phones; no separate app needed.

---

## Summary

| Question | Answer |
|----------|--------|
| Single codebase for web and mobile? | **Yes.** The React app in `client/` is the only frontend. |
| Do changes apply to both? | **Yes.** Change React (or shared code), run `npm run build` and `npx cap sync`, then run web and/or mobile. |
| Backend shared? | **Yes.** Same Express API serves web and mobile. |
| Best approach here? | **Capacitor:** wrap the existing web app in a native shell so one codebase powers web and mobile. |
