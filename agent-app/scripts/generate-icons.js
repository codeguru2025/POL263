/**
 * Pol263 Agent App — Icon Generator
 *
 * Prerequisites:
 *   1. Save the Pol263 logo as:  agent-app/assets/logo-source.png
 *   2. Run:  npm install --save-dev sharp   (only needed once)
 *   3. Run:  node scripts/generate-icons.js
 *
 * What it generates (all in assets/):
 *   icon.png                     — 1024×1024  shield on white  (iOS + general)
 *   splash-icon.png              — 800×800    full logo on white (launch screen)
 *   android-icon-foreground.png  — 1024×1024  shield, transparent bg (adaptive layer)
 *   android-icon-background.png  — 1024×1024  solid brand-blue square (adaptive layer)
 *   android-icon-monochrome.png  — 1024×1024  white shield, transparent bg (themed icons)
 *   favicon.png                  — 48×48      shield on white
 *   logo.png                     — 800×220    full logo, transparent bg (in-app header)
 *
 * The shield is auto-cropped from the LEFT portion of the source logo.
 * Adjust SHIELD_CROP_RATIO below if the crop is slightly off.
 */

const sharp = require("sharp");
const path  = require("path");
const fs    = require("fs");

const ASSETS           = path.join(__dirname, "..", "assets");
const SOURCE           = path.join(ASSETS, "logo-source.png");
const BRAND_BLUE       = "#1e3a5f";

// The Pol263 logo has the shield in the left ~33% of the full image.
// Increase this if the crop cuts into the shield; decrease if text bleeds in.
const SHIELD_CROP_RATIO = 0.33;

if (!fs.existsSync(SOURCE)) {
  console.error("\n❌  assets/logo-source.png not found.");
  console.error("   Save the Pol263 logo image there first, then re-run this script.\n");
  process.exit(1);
}

/** Extract just the shield symbol from the left portion of the source logo */
async function getShieldBuffer() {
  const meta = await sharp(SOURCE).metadata();
  const cropW = Math.round(meta.width  * SHIELD_CROP_RATIO);
  const cropH = meta.height;
  // trim() auto-removes all surrounding white/near-white padding so the shield
  // fills its bounding box tightly before we centre it on the icon canvas.
  return sharp(SOURCE)
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .trim({ background: "#ffffff", threshold: 20 })
    .toBuffer();
}

/** Shield centred on a white square canvas */
async function makeOnWhite(size, outputName, shieldBuf) {
  const padded = Math.round(size * 0.78);
  const off    = Math.round((size - padded) / 2);
  const logo   = await sharp(shieldBuf)
    .resize(padded, padded, { fit: "contain", background: "#ffffff00" })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffffff" } })
    .composite([{ input: logo, top: off, left: off }])
    .png()
    .toFile(path.join(ASSETS, outputName));
  console.log(`✅  ${outputName}  (${size}×${size}, shield on white)`);
}

/** Shield centred on a transparent square canvas */
async function makeTransparent(size, outputName, shieldBuf) {
  const padded = Math.round(size * 0.72);
  const off    = Math.round((size - padded) / 2);
  const logo   = await sharp(shieldBuf)
    .resize(padded, padded, { fit: "contain", background: "#00000000" })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#00000000" } })
    .composite([{ input: logo, top: off, left: off }])
    .png()
    .toFile(path.join(ASSETS, outputName));
  console.log(`✅  ${outputName}  (${size}×${size}, shield on transparent)`);
}

/** White-only silhouette of the shield — Android themed/monochrome icon */
async function makeMonochrome(size, outputName, shieldBuf) {
  const padded = Math.round(size * 0.72);
  const off    = Math.round((size - padded) / 2);
  // Convert to grayscale → threshold → white mask on transparent
  const mono = await sharp(shieldBuf)
    .resize(padded, padded, { fit: "contain", background: "#00000000" })
    .greyscale()
    // Make anything lighter than mid-grey white, everything else transparent
    .toBuffer();
  // Composite the white shield over transparent
  const whiteMask = await sharp(mono)
    .threshold(80)           // binarise
    .negate({ alpha: false }) // invert so shield is white on black
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#00000000" } })
    .composite([{ input: whiteMask, blend: "over", top: off, left: off }])
    .png()
    .toFile(path.join(ASSETS, outputName));
  console.log(`✅  ${outputName}  (${size}×${size}, white monochrome)`);
}

/** Solid brand-blue square — Android adaptive background layer */
async function makeSolidBackground(size, outputName) {
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BLUE } })
    .png()
    .toFile(path.join(ASSETS, outputName));
  console.log(`✅  ${outputName}  (${size}×${size}, solid ${BRAND_BLUE})`);
}

async function run() {
  console.log("\n🎨  Generating Pol263 app icons …\n");

  const shield = await getShieldBuffer();
  console.log("   Shield extracted from logo source\n");

  // ── App icon (shield on white) ──────────────────────────────────────────
  await makeOnWhite(1024, "icon.png", shield);

  // ── Splash / launch screen (full logo, white bg) ────────────────────────
  // Use the FULL source for the splash (show the whole brand name)
  const splashLogo = await sharp(SOURCE)
    .resize(640, 640, { fit: "contain", background: "#ffffff00" })
    .toBuffer();
  const splashOff = Math.round((800 - 640) / 2);
  await sharp({ create: { width: 800, height: 800, channels: 4, background: "#ffffffff" } })
    .composite([{ input: splashLogo, top: splashOff, left: splashOff }])
    .png()
    .toFile(path.join(ASSETS, "splash-icon.png"));
  console.log("✅  splash-icon.png  (800×800, full logo on white)");

  // ── Android adaptive foreground (shield, transparent) ───────────────────
  await makeTransparent(1024, "android-icon-foreground.png", shield);

  // ── Android adaptive background (solid blue) ────────────────────────────
  await makeSolidBackground(1024, "android-icon-background.png");

  // ── Android monochrome (white silhouette, transparent bg) ───────────────
  await makeMonochrome(1024, "android-icon-monochrome.png", shield);

  // ── Favicon (shield on white, tiny) ─────────────────────────────────────
  await makeOnWhite(48, "favicon.png", shield);

  // ── In-app header logo (full logo, transparent, wide) ───────────────────
  await sharp(SOURCE)
    .resize(800, 220, { fit: "contain", background: "#ffffff00" })
    .png()
    .toFile(path.join(ASSETS, "logo.png"));
  console.log("✅  logo.png  (800×220, full logo transparent — in-app header)");

  console.log("\n🎉  All icons generated successfully!");
  console.log("   Rebuild the APK to see the changes on your device.\n");
}

run().catch(e => { console.error("\nError:", e.message); process.exit(1); });
