# Database setup for POL263

The app uses **PostgreSQL**. You can use a **free cloud database**, **DigitalOcean’s inbuilt database** (when deploying on App Platform), or **PostgreSQL on your computer**.

**Production on DigitalOcean App Platform:** You can add a Database component in the same app and bind `DATABASE_URL`; see **[docs/DEPLOY-DIGITALOCEAN-APP.md](DEPLOY-DIGITALOCEAN-APP.md)**.

---

## Option A: Free cloud database (recommended)

No install on your PC. You get a connection URL and paste it into `.env`.

### Neon (free tier)

1. Go to **[neon.tech](https://neon.tech)** and sign up (free).
2. Create a new project (e.g. "POL263").
3. Copy the **connection string** (looks like `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`).
4. Open the `.env` file in this project and set:
   ```env
   DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   (Paste your real URL instead of the example.)

### Supabase (free tier)

1. Go to **[supabase.com](https://supabase.com)** and sign up (free).
2. Create a new project.
3. In the project: **Settings → Database**. Copy the **Connection string** (URI).
4. Put it in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   Use your actual password and URL from Supabase.

### Then: create tables and seed data

In a terminal, in this project folder, run:

```bash
npm run db:setup
```

This will:

1. Create all tables in your database (`db:push`).
2. Insert default roles, permissions, organization, and a superuser placeholder (`db:seed`).

If you see any prompt like “Apply changes?”, type **y** and press Enter.

After that, start the app with `npm run dev` and open http://127.0.0.1:5000.

---

## Option B: PostgreSQL on your computer

### Install PostgreSQL

- **Windows:** Download the installer from **[postgresql.org/download/windows](https://www.postgresql.org/download/windows/)** and run it. Remember the password you set for the `postgres` user.
- **Mac:** `brew install postgresql@16` then `brew services start postgresql@16` (or use the Postgres.app from [postgresapp.com](https://postgresapp.com)).

### Create the database

Open a terminal and run (adjust username if needed):

**Windows (Command Prompt or PowerShell):**

```bash
psql -U postgres -c "CREATE DATABASE pol263;"
```

**Mac/Linux:**

```bash
psql -U postgres -c "CREATE DATABASE pol263;"
```

If `psql` is not in your PATH, use the full path (e.g. `"C:\Program Files\PostgreSQL\16\bin\psql"` on Windows).

### Set DATABASE_URL in .env

Open the `.env` file in this project and set:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pol263
```

Replace `YOUR_PASSWORD` with the password you set for the `postgres` user.

### Create tables and seed data

In this project folder, run:

```bash
npm run db:setup
```

Then start the app:

```bash
npm run dev
```

Open http://127.0.0.1:5000 in your browser.

---

## Summary

| Step | Command or action |
|------|--------------------|
| 1. Get PostgreSQL | Option A: Neon or Supabase (free). Option B: Install Postgres locally and create database `pol263`. |
| 2. Put URL in `.env` | `DATABASE_URL=postgresql://...` |
| 3. Create tables + seed | `npm run db:setup` |
| 4. Run the app | `npm run dev` → open http://127.0.0.1:5000 |

---

## Optional: auto-setup when the server starts

If you want the server to create tables and run the seed **when it starts** (e.g. first run only), add to `.env`:

```env
RUN_DB_BOOTSTRAP=true
```

Then run `npm run dev` once. After the first successful run you can set `RUN_DB_BOOTSTRAP=false` or remove it so it doesn’t run again on every start.

---

## Superuser login (seed default)

The seed creates a placeholder user with the email in `SUPERUSER_EMAIL` (default: `ausiziba@gmail.com`). To sign in as staff you need **Google OAuth** configured, or enable demo login by adding to `.env`:

```env
ENABLE_DEMO_LOGIN=true
```

Then you can use the demo login option on the staff portal (when not in production).
