/**
 * Dynamic config so build-time values can come from environment variables instead of
 * being committed to the repo (same reasoning as agent-app/app.config.js). Expo CLI
 * auto-loads .env (and .env.local) into process.env before evaluating this file.
 */
module.exports = {
  expo: {
    name: "POL263",
    slug: "client-app",
    version: "1.0.0",
    scheme: "pol263client",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
    },
    android: {
      package: "com.pol263.clientapp",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      eas: {
        projectId: "1deb4d81-c0b6-4d12-99c6-1ba60156f7b5",
      },
    },
    plugins: ["expo-router", "expo-splash-screen"],
  },
};
