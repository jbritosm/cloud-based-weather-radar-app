// Service worker: makes the app installable and lets its shell (HTML, JS, CSS, icons) open offline.
//
// What is NOT cached, on purpose:
//  - /api/*: live data, a stale answer would be misleading.
//  - anything from another origin (map, satellite and radar tiles): those requests are left to the
//    browser, so weather images are never served stale from here.
// When offline the app opens, but the map has no data until the connection returns.
//
// Bump VERSION when this file's behaviour changes, so old caches are removed.
const VERSION = "v1";
const CACHE = `tfg-shell-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

// Fetch the home page and the assets it references (hashed JS/CSS), so the very first visit is
// already enough to work offline afterwards.
async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch("/", { cache: "reload" });
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|png|svg|webmanifest))"/g)].map(
    (match) => match[1],
  );
  await cache.put("/", response);
  await cache.addAll([...new Set([...assets, "/manifest.webmanifest", "/icons/icon-192.png"])]);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("tfg-shell-") && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // tiles etc.: browser handles them
  if (url.pathname.startsWith("/api/")) return; // live data: never cached

  // Page loads: the network first (so updates arrive), the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (url.pathname === "/" && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/", { ignoreSearch: true })),
    );
    return;
  }

  // Static files: hashed names never change, so the cache is always right.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
