# Deploy checklist – get changes into production

After you push to `main`, use this so production runs the new code and users see updates.

## 1. Build and restart on the server

On your production server (or let your platform do it):

```bash
git pull origin main
npm run build
# Then restart the app (e.g. restart the process that runs npm run start)
npm run start
```

- **`npm run build`** builds the client (Vite) and server (esbuild) into `dist/`. Production serves from `dist/` and runs `dist/index.cjs`.
- **Restart** is required so the new server bundle and static files are used.

## 2. If you use a host (Replit, Railway, Render, etc.)

- Trigger a **redeploy** from `main` (or push to the deploy branch). The host usually runs `npm run build` and then starts the app.
- No extra steps unless your host uses a custom build/start command.

## 3. After deploy – cache and “Something went wrong”

- **index.html** is sent with `Cache-Control: no-store, no-cache, must-revalidate`, so a normal reload should fetch the latest HTML and new script tags.
- If users still see old behaviour or “Something went wrong” after a deploy, they can:
  - Use **“Reload to update”** on the error screen (for chunk/network errors), or
  - Do a **hard refresh**: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).

## Quick reference

| Step              | Command / action                    |
|-------------------|-------------------------------------|
| Pull latest       | `git pull origin main`              |
| Build             | `npm run build`                     |
| Start production  | `npm run start`                     |
| User sees update  | Reload page (or hard refresh)      |
