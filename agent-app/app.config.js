/**
 * Dynamic config (replaces the old static app.json) so the Google Maps Android API key
 * can come from an environment variable instead of being committed to the repo. Expo CLI
 * auto-loads .env (and .env.local) into process.env before evaluating this file — see
 * https://docs.expo.dev/guides/environment-variables/ — no extra dotenv setup needed.
 * Unset GOOGLE_MAPS_ANDROID_API_KEY is fine for every screen except the dispatcher map
 * (app/(app)/dispatcher-map.tsx): the map mounts but tiles won't render without a key.
 */
module.exports = {
  expo: {
    name: "POL263 Agent",
    slug: "agent-app",
    version: "1.0.0",
    scheme: "pol263",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY || undefined,
        },
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      eas: {
        projectId: "8905c80d-6a54-4bc8-985f-c938d4652d0c",
      },
    },
    plugins: [
      "expo-router",
      "expo-splash-screen",
      [
        "expo-camera",
        {
          cameraPermission: "POL263 needs camera access to scan attendance QR codes.",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "POL263 uses your location at the moment you scan to confirm you're at the right site — it does not track you in the background.",
        },
      ],
    ],
  },
};
