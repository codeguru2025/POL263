import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Resolve public dir: when running from dist/index.cjs, __dirname is dist/ so dist/public.
  // Fallback to cwd/dist/public if __dirname/public doesn't exist (e.g. some run contexts).
  const fromDir = path.resolve(__dirname, "public");
  const fromCwd = path.resolve(process.cwd(), "dist", "public");
  const distPath = fs.existsSync(fromDir) ? fromDir : fromCwd;

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory (tried ${fromDir} and ${fromCwd}). Run 'npm run build' first.`,
    );
  }

  // Resolve index.html to an absolute path once at startup
  let indexPath = path.resolve(distPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Could not find index.html at ${indexPath}. Run 'npm run build' first.`);
  }

  // Serve static files first (manifest.json, favicon.png, assets/*, etc.) so they don't 404.
  app.use(express.static(distPath, { maxAge: "1y", immutable: true }));

  // SPA fallback: serve index.html for any path that isn't a static asset, so /staff, /client, etc. work.
  // Use regex to avoid path-to-regexp v8 "Missing parameter name" for wildcard (Express 5).
  app.get(/(.*)/, (req, res, next) => {
    const looksLikeAsset = req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path);
    if (looksLikeAsset) {
      return next(); // no file found by static above; pass through to 404
    }
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    // Re-resolve in case cwd or __dirname differs at request time (e.g. Windows)
    const filePath = fs.existsSync(indexPath) ? indexPath : path.resolve(process.cwd(), "dist", "public", "index.html");
    res.sendFile(filePath, (err: NodeJS.ErrnoException | null) => {
      if (err) {
        if (err.code === "ENOENT" || (err as any).status === 404) {
          res.status(404).send("Not found");
        } else {
          res.status(500).send("Internal Server Error");
        }
      }
    });
  });
}
