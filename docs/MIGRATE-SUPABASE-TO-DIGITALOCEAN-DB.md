# Moving from Supabase to DigitalOcean Managed PostgreSQL

Use your **DigitalOcean Managed Database** connection details to point POL263 at DO instead of Supabase. No code changes are required.

## 1. What you need from DigitalOcean

From your database’s **Connection parameters** (or **Connection string**):

- **Host:** e.g. `pol263-do-user-xxxxx-0.f.db.ondigitalocean.com`
- **Port:** e.g. `25060`
- **User:** e.g. `doadmin`
- **Password:** (the one shown in the dashboard)
- **Database:** e.g. `defaultdb`
- **SSL:** `require`

**Connection string format:**

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

Example (replace with your real password):

```text
postgresql://doadmin:YOUR_PASSWORD@pol263-do-user-33959290-0.f.db.ondigitalocean.com:25060/defaultdb?sslmode=require
```

## 2. Set up the app to use DigitalOcean

1. **Create or edit `.env`** in the project root (never commit `.env`).

2. **Set `DATABASE_URL`** to your DO connection string:

   ```env
   DATABASE_URL=postgresql://doadmin:YOUR_PASSWORD@pol263-do-user-33959290-0.f.db.ondigitalocean.com:25060/defaultdb?sslmode=require
   ```

3. **Optional** (only if you see SSL errors):  
   ```env
   DB_ACCEPT_SELF_SIGNED=true
   ```  
   DigitalOcean Managed DB usually works without this.

4. **Rotate the database password** in the DigitalOcean dashboard if you ever pasted the real password somewhere (chat, notes, etc.). Then update `DATABASE_URL` in `.env` with the new password.

## 3. Run migrations on the new database

With `DATABASE_URL` pointing at your DO database:

```bash
npx tsx script/run-migrations.ts
```

This creates all tables and runs existing migrations. Each migration is applied only once (tracked in `schema_migrations`).

## 4. Migrating data from Supabase (if you have existing data)

If you already have data in Supabase and want to move it to DO:

### Option A: pg_dump (Supabase) → pg_restore (DO)

1. **Export from Supabase**  
   In Supabase: **Settings → Database → Connection string** (use “URI” and your password). Then from your machine:

   ```bash
   pg_dump "postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require" --no-owner --clean --if-exists -f supabase_dump.sql
   ```

2. **Import into DigitalOcean**  
   Use the DO connection string in `.env`:

   ```bash
   psql "postgresql://doadmin:YOUR_PASSWORD@pol263-do-user-33959290-0.f.db.ondigitalocean.com:25060/defaultdb?sslmode=require" -f supabase_dump.sql
   ```

   Or with `pg_restore` for custom format dumps.

3. **Run migrations again** (safe; already-applied migrations are skipped):

   ```bash
   npx tsx script/run-migrations.ts
   ```

### Option B: Fresh start on DO

If you don’t need to keep Supabase data:

1. Set `DATABASE_URL` to the DO connection string.
2. Run `npx tsx script/run-migrations.ts`.
3. Optionally run seed: `npx tsx script/run-seed.ts` (if you use it).
4. Use the app against the new DO database; no Supabase data is copied.

## 5. Deploy (e.g. App Platform)

In DigitalOcean App Platform (or your host), set the **DATABASE_URL** environment variable to the same connection string. Do not commit the real password; use the dashboard or secrets so it stays out of the repo.

## 6. Security reminder

- **Never commit `.env`** or paste real passwords into chat, docs, or the repo.
- **Rotate the DB password** in the DO dashboard if it was ever exposed, then update `DATABASE_URL` everywhere (local `.env`, App Platform env, etc.).

Once `DATABASE_URL` points at your DO database and migrations have run, the app uses DigitalOcean instead of Supabase with no code changes.
