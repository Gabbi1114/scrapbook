const CACHE_NAME = "app-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/assets/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticShellAsset(requestUrl, destination) {
  if (requestUrl.origin !== self.location.origin) return false;
  if (requestUrl.pathname.startsWith("/api/")) return false;
  return (
    requestUrl.pathname.startsWith("/assets/") &&
    (destination === "script" || destination === "style" || destination === "font")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Keep dynamic routes and share pages network-first to avoid stale project content.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      }),
    );
    return;
  }

  if (!isStaticShellAsset(url, request.destination)) return;

  // Static shell assets only: cache-first with background refresh.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        networkPromise.catch(() => null);
        return cached;
      }

      const network = await networkPromise;
      return network || Response.error();
    }),
  );
});
