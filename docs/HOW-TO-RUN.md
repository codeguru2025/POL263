# How to Run Falakhe PMS

Everything is already set up in this project. Use these steps — no coding required.

---

## Database (required first time)

The app needs a **PostgreSQL** database. If you haven’t set one up yet:

1. Get a free cloud database (e.g. [Neon](https://neon.tech) or [Supabase](https://supabase.com)), or install PostgreSQL on your computer.
2. Put the connection URL in the project’s **`.env`** file as `DATABASE_URL=postgresql://...`
3. In this folder run: **`npm run db:setup`** (creates tables and seed data).

Full steps: **[docs/DATABASE-SETUP.md](DATABASE-SETUP.md)**

---

## Run the **website** (on your computer)

1. Open a terminal in this folder.
2. Run:
   ```bash
   npm run dev
   ```
3. Open your browser at the address it shows (usually **http://localhost:5000**).

That’s it. The site and API run together.

---

## Run the **Android app** (phone or emulator)

1. Install **Android Studio** from https://developer.android.com/studio (if you don’t have it).
2. In a terminal in this folder, run:
   ```bash
   npm run cap:android
   ```
   This opens the Android project in Android Studio.
3. In Android Studio, click the green **Run** button (or press Shift+F10) to run on a connected phone or an emulator.

**First time only:** If you just cloned the repo or haven’t run the app before, run this once so the app is built and synced:

```bash
npm run setup
```

Then use `npm run cap:android` as above.

---

## Run the **iOS app** (Mac only)

iOS builds require a Mac with Xcode. If you have that:

1. In a terminal in this folder, run:
   ```bash
   npx cap add ios
   npm run cap:sync
   npm run cap:ios
   ```
2. In Xcode, click **Run** to run on a simulator or device.

On Windows, iOS is not available; use the website or Android app.

---

## One-time setup (if something is missing)

If the app doesn’t open or something is missing, run this once:

```bash
npm run setup
```

This installs dependencies, builds the app, and syncs it to the Android project. Then use **Run the website** or **Run the Android app** as above.

---

## Summary

| What you want      | Command              |
|--------------------|----------------------|
| Website            | `npm run dev`        |
| Android app        | `npm run cap:android` (after `npm run setup` once if needed) |
| First-time setup   | `npm run setup`      |

No other steps are required. Everything is implemented in this project.
