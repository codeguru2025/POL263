# App icons and favicon (POL263 logo)

The **default app logo** (POL263: shield, checkmark, documents) is used everywhere icons are shown.

## Web (browser and PWA)

| Use | Source | Notes |
|-----|--------|------|
| **Favicon** (browser tab) | `/assets/logo.png` | Set in `client/index.html` |
| **Apple touch icon** (iOS "Add to Home Screen") | `/assets/logo.png` | Same file |
| **PWA icons** (Install on desktop/mobile) | `/assets/logo.png` | `client/public/manifest.json` references this for 192×192 and 512×512; browsers scale as needed |

**Single source of truth:** Replace `client/public/assets/logo.png` with your logo; favicon, apple-touch-icon, and PWA install icons will all use it.

A copy is also kept at `client/public/favicon.png` for legacy/caching; you can keep it in sync by copying `logo.png` to `favicon.png` when you change the logo.

## Native apps (Capacitor: Android / iOS)

For **installed native builds** (Android APK/AAB and iOS IPA), the icon and splash are separate image assets:

- **Android:** `android/app/src/main/res/mipmap-*` (e.g. `ic_launcher.png`, `ic_launcher_foreground.png`, `ic_launcher_round.png`) and `drawable/splash.png` (and density variants).
- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/` and `Splash.imageset/` (multiple sizes).

To use the new POL263 logo as the native app icon and splash:

1. Export the logo at the sizes each platform expects (see Android and iOS asset catalogs for required dimensions).
2. Replace the PNGs in the paths above with those exports.
3. Rebuild the native app (`npx cap sync` and then build in Android Studio / Xcode).

After that, the new logo will appear as the app icon and splash on both computers and mobile phones for native installs.
