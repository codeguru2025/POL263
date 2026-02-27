# Publish to Google Play Console and App Store Connect

This guide walks you through taking the POL263 Android and iOS apps from this repo to **Google Play** and **App Store Connect** so you can publish (or use Internal Testing / TestFlight).

---

## Part 1: Google Play Console (Android)

### 1.1 Create a Google Play Developer account

- Go to [Google Play Console](https://play.google.com/console) and sign in with a Google account.
- Pay the **one-time $25 registration fee** and complete the developer profile.
- Accept the Developer Distribution Agreement.

### 1.2 Create the app in Play Console

1. In Play Console, click **Create app**.
2. Fill in:
   - **App name:** POL263
   - **Default language:** Your choice (e.g. English)
   - **App or game:** App
   - **Free or paid:** Free (or Paid if you charge)
3. Accept the declarations and create the app.

### 1.3 Generate an upload keystore (first time only)

You need a **keystore** to sign the Android App Bundle (AAB). Keep this file and passwords safe; you need them for all future updates.

**Option A – Using keytool (Java installed):**

```bash
cd android/app
keytool -genkey -v -keystore release.keystore -alias pol263 -keyalg RSA -keysize 2048 -validity 10000
```

Use a strong password and remember:
- **Keystore password** (e.g. `RELEASE_STORE_PASSWORD`)
- **Key password** (can be same; this is `RELEASE_KEY_PASSWORD`)
- **Key alias** (e.g. `pol263` → use as `RELEASE_KEY_ALIAS`)

**Option B – Using the project script (prints commands and GitHub setup):**

```bash
node script/generate-android-keystore.js
```

Then run the `keytool` command it prints and follow the instructions to add GitHub Secrets.

### 1.4 Add GitHub Secrets for release AAB (CI)

So that every push to `main` can produce a **signed release AAB**:

1. **Base64-encode the keystore** (do this once, on a machine where the keystore exists):

   **Linux/macOS:**
   ```bash
   base64 -i android/app/release.keystore | tr -d '\n' | pbcopy
   ```
   Or save to a file:
   ```bash
   base64 -i android/app/release.keystore | tr -d '\n' > keystore-base64.txt
   ```

   **Windows (PowerShell):**
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("android\app\release.keystore")) | Set-Clipboard
   ```

2. In your GitHub repo: **Settings → Secrets and variables → Actions**.
3. Add these **repository secrets** (never commit them):

   | Secret name                 | Value |
   |----------------------------|--------|
   | `ANDROID_KEYSTORE_BASE64`  | The full base64 string of `release.keystore` |
   | `ANDROID_KEYSTORE_PASSWORD`| Keystore password (same as in `keytool`) |
   | `ANDROID_KEY_ALIAS`        | Key alias (e.g. `pol263`) |
   | `ANDROID_KEY_PASSWORD`    | Key password |

After saving, the **Build Android Release (AAB)** job will run on every push to `main` and upload the **android-release-aab** artifact. Download it from the Actions run.

### 1.5 Local release build (without CI)

Create `android/app/keystore.properties` (do **not** commit it; add to `.gitignore`):

```properties
storeFile=release.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=pol263
keyPassword=YOUR_KEY_PASSWORD
```

Put `release.keystore` in `android/app/`. Then:

```bash
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

The AAB is at: `android/app/build/outputs/bundle/release/app-release.aab`.

### 1.6 Upload AAB to Play Console

1. In Play Console, open your app → **Release** → **Production** (or **Testing** → **Internal testing**).
2. **Create new release**.
3. **Upload** the `app-release.aab` (from CI artifact or local build).
4. Add **Release name** (e.g. `1.0 (1)`) and **Release notes**.
5. Review and **Start rollout** (or **Save** for internal testing).

### 1.7 Complete store listing and compliance

Before the app can go live you must complete (in Play Console):

- **Store listing:** Short and full description, screenshots (phone 16:9 or 9:16, at least 2), feature graphic, app icon.
- **Content rating:** Questionnaire → submit → get rating.
- **Target audience:** Age group.
- **News app declaration:** If not a news app, declare that.
- **Data safety:** What data you collect and how it’s used (align with your privacy policy).
- **App access:** If login required, provide test credentials or instructions.

After the first release is uploaded and the listing is complete, you can submit for review. Rollout can take from hours to a few days.

---

## Part 2: App Store Connect (iOS)

### 2.1 Apple Developer account

- Enroll at [Apple Developer](https://developer.apple.com/programs/) (**$99/year**).
- Complete identity verification and agreements.

### 2.2 Create the app in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **My Apps**.
2. Click **+** → **New App**.
3. Fill in:
   - **Platforms:** iOS
   - **Name:** POL263
   - **Primary language**
   - **Bundle ID:** Select or create one matching your app (e.g. `com.pol263.app` – must match `ios/App/App.xcodeproj` / Capacitor `appId`).
   - **SKU:** e.g. `pol263-001`
4. Create the app.

### 2.3 Configure Xcode project (on a Mac)

1. Open the iOS project:
   ```bash
   npm run build && npx cap sync ios
   npx cap open ios
   ```
2. In Xcode:
   - Select the **App** target → **Signing & Capabilities**.
   - Check **Automatically manage signing**.
   - Select your **Team** (Apple Developer account).
   - Set **Bundle Identifier** to match App Store Connect (e.g. `com.pol263.app`).
3. In **General**, set **Version** and **Build** (e.g. 1.0, 1). Increment **Build** for each upload.

### 2.4 Create certificates and provisioning (Xcode)

- With **Automatically manage signing** enabled, Xcode creates the **Distribution** certificate and **App Store** provisioning profile when you archive.
- If you need manual setup: **Apple Developer** → **Certificates, Identifiers & Profiles** → create **Apple Distribution** certificate and an **App Store** provisioning profile for your app’s Bundle ID.

### 2.5 Build and upload to App Store Connect

1. In Xcode, choose **Any iOS Device (arm64)** (or a connected device).
2. **Product → Archive**.
3. In the **Organizer**, select the archive → **Distribute App**.
4. Choose **App Store Connect** → **Upload** → follow the steps (signing, options).
5. After upload, go to **App Store Connect → My Apps → POL263**.
6. The new build appears under **TestFlight** and under the version in **App Store** tab (after processing, usually 5–15 minutes).

### 2.6 Complete App Store listing and submit

- **App Information:** Name, subtitle, category, privacy policy URL.
- **Pricing and Availability:** Free or price, countries.
- **App Privacy:** Privacy policy URL and data collection details (questionnaire).
- **Version information:** Screenshots (required sizes for iPhone 6.7", 6.5", 5.5"; iPad if applicable), description, keywords, support URL.
- **Build:** Select the build you uploaded.
- **Submit for Review.**

Review often takes 24–48 hours.

### 2.7 CI: iOS release build (optional)

To build and upload iOS from GitHub Actions you need:

- **macOS runner** (already used for the simulator build).
- **Apple Developer credentials** in secrets:
  - Signing certificate (e.g. base64 .p12) and password.
  - Provisioning profile (e.g. .mobileprovision).
  - Or use **match** (fastlane) / **ios-signing-action** with an Apple ID and app-specific password.

Because of code signing and Apple’s tooling, many teams do the **first iOS release and TestFlight upload from Xcode** on a Mac, then add CI signing later if desired. The existing workflow already produces a simulator build; device/TestFlight builds are best added once you have certificates and profiles set up.

---

## Summary

| Store              | Cost              | Artifact        | Where to upload                         |
|--------------------|-------------------|----------------|----------------------------------------|
| **Google Play**    | $25 one-time      | AAB from CI or local `bundleRelease` | Play Console → Release → Upload AAB    |
| **App Store**      | $99/year          | IPA via Xcode Archive → Distribute | App Store Connect (via Xcode/Transporter) |

- **Android:** Add GitHub Secrets (keystore base64 + passwords) → push to `main` → download **android-release-aab** from Actions → upload to Play Console.
- **iOS:** Build and archive in Xcode on a Mac → Distribute to App Store Connect → complete listing and submit for review.

For ongoing releases: bump **versionCode** (Android) and **Build** (iOS) and **versionName** / **Marketing version** as needed, then push (Android) or archive again (iOS).
