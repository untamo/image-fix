importScripts("./share-store.js?v=share-target-1");

// Bump VERSION and the asset URLs whenever releasing an app update.
const VERSION = "share-target-1";
const CACHE_PREFIX = `linelift:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const APP_URL = new URL("./index.html", self.registration.scope).href;
const ASSETS = [
  "./index.html",
  "./app.js?v=share-target-1",
  "./styles.css?v=share-target-1",
  "./pwa.js?v=share-target-1",
  "./share-store.js?v=share-target-1",
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
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (request.method === "POST" && url.pathname === new URL("./share-target", scope).pathname) {
    event.respondWith(receiveSharedImage(request));
    return;
  }
  if (request.method !== "GET") return;
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

async function receiveSharedImage(request) {
  const destination = new URL("./", self.registration.scope);
  try {
    const data = await request.formData();
    const files = data.getAll("image");
    const file = files[0];
    if (files.length !== 1) destination.searchParams.set("share-error", "count");
    else if (!file || typeof file.arrayBuffer !== "function" || !file.type.startsWith("image/")) {
      destination.searchParams.set("share-error", "type");
    } else if (file.size > 20 * 1024 * 1024) destination.searchParams.set("share-error", "size");
    else destination.searchParams.set("shared", await sharedImages.put(self.registration.scope, file));
  } catch {
    destination.searchParams.set("share-error", "unavailable");
  }
  // This POST is handled locally, including failures. Never forward the image.
  return Response.redirect(destination.href, 303);
}
