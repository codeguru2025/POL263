const CACHE_NAME = "pol263-v1";
const PRECACHE_URLS = [
  "/",
  "/assets/logo.png",
  "/favicon.png"
];

/* =========================
   INSTALL
========================= */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* =========================
   ACTIVATE
========================= */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* =========================
   FETCH
========================= */
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ CRITICAL FIX:
  // Ignore chrome-extension://, data:, blob:, etc.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Do not cache API requests
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetch(req)
      .then((res) => {

        // Only cache successful responses
        if (!res || !res.ok) return res;

        // Cache only static assets and root
        const isStaticAsset =
          url.pathname.match(/\.(js|css|png|svg|woff2?|jpg|jpeg|gif|ico)$/);

        if (isStaticAsset || url.pathname === "/") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, clone).catch(() => {
              // silently ignore caching errors
            });
          });
        }

        return res;
      })
      .catch(() =>
        caches.match(req).then(
          (cached) =>
            cached ||
            new Response("Offline", {
              status: 503,
              statusText: "Offline",
            })
        )
      )
  );
});