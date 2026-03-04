import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback: serve index.html for app routes so reload gets fresh HTML after deploy (no-cache). Missing assets → 404.
  // Use regex to avoid path-to-regexp v8 "Missing parameter name" for wildcard (Express 5).
  app.get(/(.*)/, (req, res) => {
    const looksLikeAsset = req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path);
    if (looksLikeAsset) {
      return res.status(404).send("Not found");
    }
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.sendFile(path.join(distPath, "index.html"));
  });
}
