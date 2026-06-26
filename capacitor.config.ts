import type { CapacitorConfig } from "@capacitor/cli";

// Set CAPACITOR_SERVER_URL at build time to make the WebView load from the live
// server instead of bundled files.  This avoids CORS issues and means tenant
// subdomain routing (e.g. falakhe.pol263.com) works automatically without a
// separate VITE_API_BASE build.  Required for production; leave unset for local
// dev where you override via the server.url comment below.
const serverUrl = process.env.CAPACITOR_SERVER_URL || undefined;

const config: CapacitorConfig = {
  appId: "com.pol263.app",
  appName: "POL263",
  webDir: "dist/public",
  server: serverUrl
    ? { url: serverUrl }
    : {
        // Dev: uncomment and set to your machine's IP:port to test on a device
        // url: "http://192.168.x.x:5000",
        // cleartext: true,
      },
};

export default config;
