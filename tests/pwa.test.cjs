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
    URL, Request, Response, File: require("node:buffer").File, crypto: require("node:crypto").webcrypto,
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
          async match(key) { const value = entries.get(key.url || key); return value?.clone ? value.clone() : value; },
          async put(key, value) { entries.set(key.url || key, value.clone()); },
          async delete(key) { return entries.delete(key.url || key); },
          async keys() { return [...entries.keys()].map((url) => new Request(url)); },
        };
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
    async fetch() { throw new Error('Offline'); },
  };
  const sandbox = vm.createContext(context);
  context.importScripts = (url) => vm.runInContext(fs.readFileSync(path.join(root, url.split('?')[0]), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sandbox);
  return {
    stores,
    async lifecycle(name) { let pending; handlers[name]({ waitUntil(value) { pending = value; } }); await pending; },
    request(url, mode = 'cors', method = 'GET') {
      let response;
      handlers.fetch({ request: { url, mode, method }, respondWith(value) { response = value; } });
      return response;
    },
    async share(files) {
      let response;
      const data = new FormData();
      for (const file of files) data.append("image", file);
      const request = new Request(`${scope}share-target`, { method: "POST", body: data });
      handlers.fetch({ request, respondWith(value) { response = value; } });
      return response;
    },
    async open(url) {
      const result = { file: null, error: "", url };
      context.navigator = {};
      context.window = { location: { href: url }, caches: context.caches,
        history: { replaceState(_state, _unused, value) { result.url = value; } }, addEventListener() {} };
      context.elements = { errorNotice: { textContent: "", scrollIntoView() {} } };
      context.setError = (message) => { result.error = message; context.elements.errorNotice.textContent = message; };
      context.loadImageFile = (file) => { result.file = file; };
      vm.runInContext(fs.readFileSync(path.join(root, 'pwa.js'), 'utf8'), sandbox);
      await context.openSharedImage();
      return result;
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

test('manifest routes image shares locally; offline handoff reaches editor once and keeps filenames', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
  assert.equal(new URL(manifest.share_target.action, scope).href, `${scope}share-target`);
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.deepEqual(manifest.share_target.params.files, [{ name: 'image', accept: ['image/*'] }]);
  const sw = worker();
  await sw.lifecycle('install');
  const File = require('node:buffer').File;
  const first = await sw.share([new File(['first-photo'], 'mökkikuva.png', { type: 'image/png' })]);
  const second = await sw.share([new File(['second-photo'], 'other.jpg', { type: 'image/jpeg' })]);
  assert.equal(first.status, 303);
  const url = first.headers.get('Location');
  assert.notEqual(url, second.headers.get('Location'));
  assert.match((await sw.request(url, 'navigate')).toString(), /id="chooseButton"/);
  const opened = await sw.open(url);
  assert.equal(await opened.file.text(), 'first-photo');
  assert.equal(opened.file.name, 'mökkikuva.png');
  assert.equal(opened.url, scope);
  assert.equal(opened.error, '');
  assert.match((await sw.open(url)).error, /expired/);
  const other = await sw.open(second.headers.get('Location'));
  assert.equal(await other.file.text(), 'second-photo');
  assert.equal(sw.stores.get(`linelift-shares:${scope}`).size, 0);
});

test('invalid, multiple, oversized and expired image shares return recoverable errors offline', async () => {
  const sw = worker();
  const File = require('node:buffer').File;
  const photo = new File(['image'], 'photo.png', { type: 'image/png' });
  for (const [files, code] of [[[], 'count'], [[photo, photo], 'count'], [['text only'], 'type'],
    [[new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })], 'size']]) {
    const response = await sw.share(files);
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('Location')).searchParams.get('share-error'), code);
    assert.ok((await sw.open(response.headers.get('Location'))).error);
  }
  const response = await sw.share([photo]);
  const entries = sw.stores.get(`linelift-shares:${scope}`);
  for (const entry of entries.values()) entry.headers.set('X-Expires', '1');
  assert.match((await sw.open(response.headers.get('Location'))).error, /expired/);
  assert.equal(entries.size, 0);
});
