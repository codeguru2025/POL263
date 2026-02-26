#!/usr/bin/env node
/**
 * Prints instructions and the keytool command to generate an Android release keystore,
 * and how to add the base64 keystore to GitHub Secrets for CI release AAB builds.
 *
 * Run: node script/generate-android-keystore.js
 */

const path = require("path");
const fs = require("fs");

const KEYSTORE_PATH = path.join(__dirname, "..", "android", "app", "release.keystore");
const KEYSTORE_DIR = path.dirname(KEYSTORE_PATH);

console.log(`
========================================
Android release keystore for POL263
========================================

Step 1 – Generate the keystore (run this command once, keep the file and passwords safe):

  cd android/app
  keytool -genkey -v -keystore release.keystore -alias pol263 -keyalg RSA -keysize 2048 -validity 10000

  You will be asked for:
  - Keystore password (e.g. choose a strong password)
  - Key password (can be same as keystore password)
  - Your name, org, city, etc.

  Use the SAME alias (e.g. pol263) and passwords when adding GitHub Secrets below.

Step 2 – Add GitHub Secrets (repo -> Settings -> Secrets and variables -> Actions):

  Create these repository secrets:

  | Name                        | Value |
  |-----------------------------|-------|
  | ANDROID_KEYSTORE_BASE64     | (see below) |
  | ANDROID_KEYSTORE_PASSWORD   | (your keystore password) |
  | ANDROID_KEY_ALIAS           | pol263 |
  | ANDROID_KEY_PASSWORD        | (your key password) |

  To get ANDROID_KEYSTORE_BASE64 after creating the keystore:

  Linux/macOS:
    base64 -i android/app/release.keystore | tr -d '\\n' | pbcopy
    (then paste into the secret value)

  Windows PowerShell:
    [Convert]::ToBase64String([IO.File]::ReadAllBytes("android\\app\\release.keystore")) | Set-Clipboard

Step 3 – Push to main

  The workflow will run "Build Android Release (AAB)" and upload the android-release-aab artifact.
  Download the AAB from the Actions run and upload it in Google Play Console.

Full doc: docs/GOOGLE-PLAY-AND-APP-STORE.md
========================================
`);

if (fs.existsSync(KEYSTORE_PATH)) {
  console.log("Keystore already exists at:", KEYSTORE_PATH);
  console.log("To regenerate, delete it and run the keytool command above.\n");
} else {
  console.log("Keystore not found yet. Run the keytool command above to create it.\n");
}
