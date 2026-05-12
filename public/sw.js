/**
 * Service Worker — network-first strategy for all dynamic content.
 * Static shell assets (JS/CSS/fonts) are cached with network-first + stale fallback.
 * API endpoints are NEVER cached.
 * Version bump forces cache invalidation on every deploy.
 */
const SW_VERSION = Date.now(); // replaced at build time via cache-busting
const CACHE_NAME = `app-shell-v${SW_VERSION}`;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
      ),
  );
  // Activate immediately — don't wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Delete ALL old caches (different version name).
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticShellAsset(requestUrl, destination) {
  if (requestUrl.origin !== self.location.origin) return false;
  if (requestUrl.pathname.startsWith("/api/")) return false;
  // Vite hashed assets under /assets/ are safe to cache.
  return (
    requestUrl.pathname.startsWith("/assets/") &&
    (destination === "script" ||
      destination === "style" ||
      destination === "font" ||
      destination === "image")
  );
}

function isDynamicApiRequest(requestUrl) {
  return requestUrl.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // API calls: always network-only, no caching.
  if (isDynamicApiRequest(url)) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => Response.error()),
    );
    return;
  }

  // Navigation (HTML pages): network-first, fall back to cached index.html for SPA.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-cache" }).catch(async () => {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      }),
    );
    return;
  }

  // Static hashed assets: network-first, update cache, serve stale on failure.
  if (isStaticShellAsset(url, request.destination)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(request, { cache: "no-cache" })
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cache.match(request).then((c) => c || Response.error())),
      ),
    );
    return;
  }

  // Everything else: network-first, no caching.
  event.respondWith(
    fetch(request, { cache: "no-cache" }).catch(() => Response.error()),
  );
});

// Listen for SKIP_WAITING message from the client to force update.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
