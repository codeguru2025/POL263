/**
 * Ensures package-lock.json is in sync with package.json.
 * Exits 1 if lock file would change after npm install --package-lock-only.
 * Use before commit/CI to avoid "npm lockfile is not in sync" on deploy.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const lockPath = path.join(process.cwd(), 'package-lock.json');
if (!fs.existsSync(lockPath)) {
  console.error('ERROR: package-lock.json is missing. Run "npm install" and commit it.');
  process.exit(1);
}
const before = fs.readFileSync(lockPath, 'utf8');
execSync('npm install --package-lock-only', { stdio: 'inherit' });
const after = fs.readFileSync(lockPath, 'utf8');

if (before !== after) {
  console.error(
    'ERROR: package-lock.json is out of sync with package.json. Run "npm install" and commit the updated package-lock.json.'
  );
  process.exit(1);
}
console.log('Lock file is in sync.');
