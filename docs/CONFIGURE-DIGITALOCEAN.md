# Configure DigitalOcean for POL263 (optional)

**The app works with Supabase by default.** Use this guide only if you want to switch your database to DigitalOcean Managed PostgreSQL.

---

## What’s already done (on your machine)

- **`.env`** in the project root has been created/updated with:
  - `DATABASE_URL` → your DigitalOcean PostgreSQL connection string  
  - `SESSION_SECRET` → a generated value for session encryption  
  - `NODE_ENV`, `PORT`  

Do **not** commit `.env` (it’s in `.gitignore`).  
**Security:** If the DB password was ever exposed, rotate it in the DO dashboard and update `DATABASE_URL` in `.env`.

---

## Step 1: Create base tables (Drizzle schema push)

**For DigitalOcean:** Use this command (it temporarily relaxes SSL verification so drizzle-kit can connect):

```bash
npm run db:push:do
```

For other hosts, you can use `npm run db:push` first; if you get an SSL certificate error, use `npm run db:push:do` instead.

When prompted about tables (e.g. “create table” vs “rename”), choose **create table** (first option) and press Enter. Repeat for each table if asked.  
This creates all base tables (organizations, users, policies, etc.) in your DO database.

---

## Step 2: Run incremental migrations

Then run the SQL migrations (adds columns and tables added over time):

```bash
npx tsx script/run-migrations.ts
```

---

## Step 3: (Optional) Seed or import data

- **Fresh start:**  
  If you use the seed script:  
  `npx tsx script/run-seed.ts`  
  (Only if your project is set up for it and you want demo/seed data.)

- **Moving from Supabase:**  
  See **`docs/MIGRATE-SUPABASE-TO-DIGITALOCEAN-DB.md`** for `pg_dump` from Supabase and loading into DO.

---

## Step 4: Run the app locally (verify DO connection)

```bash
npm run dev
```

Open the app (e.g. http://localhost:5000). Log in or create a tenant and confirm data is read/written.  
If you see DB or SSL errors, try adding to `.env`:

```env
DB_ACCEPT_SELF_SIGNED=true
```

---

## Step 5: Deploy the app on DigitalOcean App Platform

If you want the app hosted on DO (not only the database):

### 4.1 Create an App

1. In **DigitalOcean**: **Apps** → **Create App**.
2. Connect your **GitHub** (or Git) repo and select the POL263 repo/branch.
3. Choose **Web Service** (not Static Site).

### 4.2 Build and run settings

- **Build command:**  
  `npm run build`  
  or (if you use a different script):  
  `npm install && npm run build`

- **Run command:**  
  `npm run start`  
  or:  
  `node dist/index.cjs`  
  (Match what’s in your `package.json` `scripts.start`.)

- **HTTP port:**  
  Set to the port your app listens on (e.g. `5000` or `PORT` from env).  
  App Platform expects the app to listen on `PORT` (they set it automatically); ensure your app uses `process.env.PORT || 5000`.

### 4.3 Environment variables (required)

In the App’s **Settings** → **App-Level Environment Variables** (or the component’s env), add:

| Variable           | Value / notes |
|--------------------|----------------|
| `DATABASE_URL`     | Your full DO Postgres connection string (same as in `.env`). **Use “Encrypt” or a secret so the password isn’t visible in plain text.** |
| `SESSION_SECRET`   | Same long random string as in `.env` (e.g. from `npm run generate-secret`). **Encrypt.** |
| `NODE_ENV`         | `production` |

Do **not** commit these values in the repo; set them only in the DO dashboard.

### 4.4 Optional env vars (as needed)

- **Google OAuth:**  
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`  
  (Use your production callback URL, e.g. `https://your-app.ondigitalocean.app/api/auth/google/callback`.)

- **Paynow:**  
  `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`,  
  `PAYNOW_RETURN_URL`, `PAYNOW_RESULT_URL`  
  (Result URL must be publicly reachable, e.g. `https://your-app.ondigitalocean.app/api/payments/paynow/result`.)

- **Public URL (for links/redirects):**  
  `APP_BASE_URL=https://your-app.ondigitalocean.app`  
  If you use a build-time variable for the client, e.g. `VITE_APP_PUBLIC_URL`, set it in the build env to the same URL.

### 4.5 Database: same cluster or “add database” component

- **Option A — Use your existing Managed Database**  
  Leave **Database** component empty. Only set `DATABASE_URL` in the app’s env to your existing DO Postgres URI (as in `.env`).  
  Migrations are already run in Step 1.

- **Option B — Add a Database component**  
  If you add a new Database component in the same App, DO will give you a new `DATABASE_URL`. Then you must run migrations against that new DB (run `npx tsx script/run-migrations.ts` locally with that URL, or add a one-off job to run it).  
  For your current setup (existing DO database), **Option A** is what you want.

### 4.6 Deploy

Save settings and deploy. After deploy, open the app URL and test login and key flows.

---

## Step 6: Database password rotation (recommended)

Because the DB password was used in chat or in `.env`:

1. In **DigitalOcean** → your **Database** → **Users & Databases** (or equivalent).
2. **Reset the password** for `doadmin` (or the user in your connection string).
3. Update **everywhere** that uses it:
   - Local **`.env`**: `DATABASE_URL=postgresql://doadmin:NEW_PASSWORD@...`
   - **App Platform** env: update `DATABASE_URL` with the new password.
4. Redeploy the app if you only changed the env in the dashboard (DO usually picks it up on next deploy or restart).

---

## Quick reference

| Task                    | Command or place |
|-------------------------|------------------|
| Create base tables      | `npm run db:push` (or `npm run db:push:do` if SSL error) |
| Run migrations          | `npx tsx script/run-migrations.ts` |
| Run app locally         | `npm run dev` |
| Generate new secret     | `npm run generate-secret` |
| Migrate data from Supabase | `docs/MIGRATE-SUPABASE-TO-DIGITALOCEAN-DB.md` |

Once `DATABASE_URL` and `SESSION_SECRET` are set (locally and on App Platform) and migrations have run, POL263 is configured to use your DigitalOcean database and, if you deploy, to run on DigitalOcean App Platform.
