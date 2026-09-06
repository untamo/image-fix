const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const scope = 'https://untamo.github.io/image-fix/';

function worker() {
  const handlers = {};
  const stores = new Map();
  let claims = 0;
  const context = {
    URL, Request,
    self: { registration: { scope }, clients: { async claim() { claims++; } },
      addEventListener(name, handler) { handlers[name] = handler; } },
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const entries = stores.get(name);
        return {
          async addAll(requests) {
            for (const request of requests) {
              const file = new URL(request.url).pathname.slice(new URL(scope).pathname.length);
              entries.set(request.url, fs.readFileSync(path.join(root, file)));
            }
          },
          async match(key) { return entries.get(key); },
        };
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
    async fetch() { throw new Error('Offline'); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  return {
    stores,
    async lifecycle(name) { let pending; handlers[name]({ waitUntil(value) { pending = value; } }); await pending; },
    request(url, mode = 'cors', method = 'GET') {
      let response;
      handlers.fetch({ request: { url, mode, method }, respondWith(value) { response = value; } });
      return response;
    },
    get claims() { return claims; },
  };
}

test('Android manifest stays in app scope with correctly sized opaque icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
  assert.equal(new URL(manifest.start_url, scope).href, scope);
  assert.equal(new URL(manifest.scope, scope).href, scope);
  assert.equal(new URL(manifest.id, scope).href, scope);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, 'LineLift');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon);
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 2); // RGB, no transparent maskable background.
  }
});

test('first online install caches all page dependencies for an offline launch', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.equal(sw.claims, 1);
  const html = (await sw.request(scope, 'navigate')).toString();
  assert.match(html, /id="chooseButton"/);
  const dependencies = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const dependency of dependencies) {
    assert.ok(await sw.request(new URL(dependency, scope).href), `${dependency} is available offline`);
  }
  assert.equal((await sw.request(`${scope}index.html?launch=home`, 'navigate')).toString(), html);
});

test('activation removes only obsolete LineLift caches; private and unrelated requests bypass caching', async () => {
  const sw = worker();
  const old = `linelift:${scope}:old`;
  const unrelated = 'another-app-cache';
  sw.stores.set(old, new Map());
  sw.stores.set(unrelated, new Map());
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.equal(sw.stores.has(old), false);
  assert.equal(sw.stores.has(unrelated), true);
  for (const url of [`${scope}photo.jpg`, 'blob:https://untamo.github.io/photo', 'https://untamo.github.io/other/', 'https://example.com/image-fix/']) {
    assert.equal(sw.request(url), undefined);
  }
  assert.equal(sw.request(scope, 'navigate', 'POST'), undefined);
});
