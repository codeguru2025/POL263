# POL263 Agent Mobile App

Offline-first React Native (Expo) app for insurance agents. Agents can capture clients and issue policies even without internet — data syncs automatically when connectivity is restored.

## Features

- **Offline-first**: Capture clients and issue policies without internet
- **Auto-sync**: Automatically pushes local data to server when online
- **SQLite storage**: All local data persisted in on-device database
- **Session auth**: Uses existing agent login (email + password)
- **Policy number generation**: Server assigns policy numbers upon sync

## Screens

| Screen | Description |
|--------|-------------|
| Login | Agent email/password authentication |
| Dashboard | Stats, sync status, online/offline indicator |
| Clients | Browse, search, create clients (offline capable) |
| Policies | Browse policies, issue new (offline capable) |
| Settings | Sync controls, profile, logout |

## How Offline Works

1. Agent captures a client → saved to local SQLite with `synced = 0`
2. Agent issues a policy → saved locally, status = `pending_sync`
3. When online, the sync engine:
   - Pushes unsynced clients first (server returns `client.id`)
   - Pushes unsynced policies using server client IDs
   - Server generates policy number and returns it
   - Pulls latest data for offline browsing cache
4. Auto-sync triggers on: app foreground, connectivity change, every 30s

## Setup

```bash
cd agent-app
npm install
```

### Development

```bash
# Start Expo dev server
npx expo start

# Run on Android emulator
npx expo run:android

# Run on iOS simulator (macOS only)
npx expo run:ios
```

### Configuration

Edit `src/config.ts` to set your API base URL:
- **Dev**: Uses `http://10.0.2.2:5000` (Android emulator → host localhost)
- **Production**: Uses `https://falakhe.pol263.com`

### Build APK

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo account
eas login

# Build APK (preview profile)
eas build -p android --profile preview

# Build production APK
eas build -p android --profile production
```

The APK will be available for download from your Expo dashboard.

### Local APK Build (no EAS account)

```bash
# Generate native Android project
npx expo prebuild --platform android

# Build APK with Gradle
cd android
./gradlew assembleRelease

# APK location: android/app/build/outputs/apk/release/app-release.apk
```

## Architecture

```
agent-app/
├── App.tsx                      # Entry point, providers
├── src/
│   ├── api.ts                   # HTTP helpers (cookie-based auth)
│   ├── config.ts                # API URL, sync interval
│   ├── theme.ts                 # Colors, spacing, typography
│   ├── context/
│   │   ├── AuthContext.tsx       # Login/logout, session management
│   │   └── NetworkContext.tsx    # Online/offline detection
│   ├── db/
│   │   └── schema.ts            # SQLite schema + initialization
│   ├── navigation/
│   │   └── AppNavigator.tsx     # Tab + stack navigation
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── ClientsScreen.tsx
│   │   ├── PoliciesScreen.tsx
│   │   ├── CreatePolicyScreen.tsx
│   │   └── SettingsScreen.tsx
│   └── sync/
│       ├── engine.ts            # Push/pull sync logic
│       └── AutoSync.tsx         # Background auto-sync component
└── eas.json                     # EAS Build config (APK profiles)
```
