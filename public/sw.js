/**
 * Service Worker — network-first for HTML/API, cache-first for hashed assets.
 * API endpoints are NEVER cached.
 * Bump SW_VERSION to force a full cache reset on clients.
 * (Must be a constant: a per-startup value like Date.now() changes the cache
 * name on every worker restart, so the cache never hits and storage leaks.)
 */
const SW_VERSION = "2";
const CACHE_NAME = `app-shell-v${SW_VERSION}`;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
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
  // Vite hashed assets under /assets/, plus static icons and fonts.
  return (
    (requestUrl.pathname.startsWith("/assets/") ||
      requestUrl.pathname.startsWith("/icons/") ||
      requestUrl.pathname.startsWith("/fonts/")) &&
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

  // Static hashed assets: content hash in the filename makes them immutable,
  // so serve from cache instantly and only hit the network on a miss.
  if (isStaticShellAsset(url, request.destination)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request)
              .then((response) => {
                if (response.ok) {
                  cache.put(request, response.clone());
                }
                return response;
              })
              .catch(() => Response.error()),
        ),
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
