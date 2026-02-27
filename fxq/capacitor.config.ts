import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pol263.app",
  appName: "POL263",
  webDir: "dist/public",
  server: {
    // Uncomment to load the app from your API in dev (e.g. avoid CORS when testing on device)
    // url: "http://YOUR_DEV_MACHINE_IP:5000",
    // cleartext: true,
  },
};

export default config;
