// Bump VERSION and the asset URLs whenever releasing an app update.
const VERSION = "android-install-1";
const CACHE_PREFIX = `linelift:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const APP_URL = new URL("./index.html", self.registration.scope).href;
const ASSETS = [
  "./index.html",
  "./app.js?v=android-install-1",
  "./styles.css?v=android-install-1",
  "./pwa.js?v=android-install-1",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
].map((path) => new URL(path, self.registration.scope).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })))));
  // Let updates wait for existing windows to close; never interrupt image edits.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const isAppNavigation = request.mode === "navigate"
    && (url.pathname === scope.pathname || url.pathname === new URL(APP_URL).pathname);
  // Cache only the application shell, never users' photographs or exports.
  const key = isAppNavigation ? APP_URL : request.url;
  if (!ASSETS.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    return cached || fetch(request);
  })());
});
