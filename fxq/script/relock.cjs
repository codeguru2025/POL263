/**
 * Remove node_modules and package-lock.json, then run npm install.
 * Use when the lockfile is corrupted or you need a clean regenerate.
 * Cross-platform (Node built-ins only).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const nodeModules = path.join(root, 'node_modules');
const lockPath = path.join(root, 'package-lock.json');

if (fs.existsSync(nodeModules)) {
  fs.rmSync(nodeModules, { recursive: true, maxRetries: 3 });
  console.log('Removed node_modules');
}
if (fs.existsSync(lockPath)) {
  fs.unlinkSync(lockPath);
  console.log('Removed package-lock.json');
}

console.log('Running npm install...');
execSync('npm install', { stdio: 'inherit', cwd: root });
console.log('Done. Run "npm run lint:lock" to verify lockfile is in sync.');
