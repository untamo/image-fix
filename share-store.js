// A short-lived local handoff between the share request and the editor window.
const sharedImages = {
  cacheName(scope) { return `linelift-shares:${scope}`; },
  key(scope, id) { return new URL(`shared-image/${id}`, scope).href; },
  async prune(scope) {
    const cache = await caches.open(this.cacheName(scope));
    for (const key of await cache.keys()) {
      const response = await cache.match(key);
      if (Number(response?.headers.get("X-Expires")) <= Date.now()) await cache.delete(key);
    }
  },
  async put(scope, file) {
    await this.prune(scope);
    const id = crypto.randomUUID();
    const cache = await caches.open(this.cacheName(scope));
    await cache.put(this.key(scope, id), new Response(file, { headers: {
      "Content-Type": file.type,
      "X-Filename": encodeURIComponent(file.name || "shared-image"),
      "X-Expires": String(Date.now() + 5 * 60 * 1000),
    } }));
    return id;
  },
  async take(scope, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    const cache = await caches.open(this.cacheName(scope));
    const key = this.key(scope, id);
    const response = await cache.match(key);
    if (!response) return null;
    const blob = await response.blob();
    await cache.delete(key);
    if (Number(response.headers.get("X-Expires")) <= Date.now()) return null;
    return new File([blob], decodeURIComponent(response.headers.get("X-Filename") || "shared-image"),
      { type: blob.type });
  },
};
