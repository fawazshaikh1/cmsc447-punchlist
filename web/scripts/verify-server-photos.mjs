/**
 * Checks photos on the server (SCRUM-45, SCRUM-54).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A NEW PHOTO GOES TO THE SERVER, filed under the open project, so every
 *    device on the project sees it and a lost tablet loses nothing.
 * 2. A PHOTO ONLY THIS BROWSER HAS is uploaded under the key its markup
 *    already records, the first time anything asks for it — no step for
 *    anyone to remember.
 * 3. NOTHING BLANKS OUT: a photo this device has still shows when the server
 *    is unreachable, and an upload that fails is tried again later.
 *
 * The server side is tested in Go against Postgres (backend/media_test.go).
 *
 * Run with: npm run verify -- photos
 */
import assert from 'node:assert/strict';

import { MediaStore } from '../src/domain/ports/MediaStore.js';
import { UploadingMediaStore } from '../src/domain/upload/UploadingMediaStore.js';
import { HttpMediaStore } from '../src/infrastructure/media/HttpMediaStore.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/** A store in memory; `upload` only on the server-like one. */
class MemoryMediaStore extends MediaStore {
  constructor({ canUpload = false } = {}) {
    super();
    this.items = new Map();
    this.uploads = [];
    if (canUpload) {
      this.upload = async (key, blob) => {
        if (this.failUploads) throw new Error('refused');
        this.uploads.push(key);
        this.items.set(key, blob);
      };
    }
  }
  async put(blob) {
    const key = `photo_${this.items.size + 1}`;
    this.items.set(key, blob);
    return key;
  }
  async get(key) {
    if (this.down) throw new TypeError('Failed to fetch');
    return this.items.get(key) ?? null;
  }
  async remove(key) {
    this.items.delete(key);
  }
}

const photo = (text = 'jpeg bytes') => new Blob([text], { type: 'image/jpeg' });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    return handler(url, init);
  };
  return { fn, calls };
}

// =========================================================================
// THE HTTP STORE
// =========================================================================

check('a new photo is sent to the open project, with its type and the app header', async () => {
  const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const store = new HttpMediaStore('/api', { projectOf: () => 12 }, fn);

  const key = await store.put(photo());

  assert.match(key, /^photo_[0-9a-f-]{36}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, `/api/media/${key}?project=12`);
  assert.equal(calls[0].headers['Content-Type'], 'image/jpeg');
  assert.equal(calls[0].headers['X-Punchlist-Request'], '1');
  assert.ok(calls[0].body instanceof Blob, 'the bytes themselves, not JSON');
});

check('no project open, no upload — and a clear reason', async () => {
  const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const store = new HttpMediaStore('/api', { projectOf: () => null }, fn);
  await assert.rejects(() => store.put(photo()), /Open a project before adding photos/);
  assert.equal(calls.length, 0);
});

check('reading: the bytes when the server has them, null when it does not or may not', async () => {
  const store = new HttpMediaStore('/api', { projectOf: () => 12 }, fakeFetch((url) => {
    if (url.endsWith('/photo_here')) return new Response('jpeg bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    if (url.endsWith('/photo_theirs')) return new Response(JSON.stringify({ error: 'You are not on this project.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'No such photo.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }).fn);

  const here = await store.get('photo_here');
  assert.equal(await here.text(), 'jpeg bytes');
  assert.equal(await store.get('photo_theirs'), null, 'a placeholder, not a crash');
  assert.equal(await store.get('photo_unknown'), null);
});

check('the server being down is an error, not a missing photo', async () => {
  const store = new HttpMediaStore('/api', { projectOf: () => 12 }, async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(() => store.get('photo_x'), /Cannot reach the Punch List server/);
});

// =========================================================================
// PHOTOS THIS BROWSER ALREADY HAD
// =========================================================================

check('a new photo goes to the server, not this browser', async () => {
  const server = new MemoryMediaStore({ canUpload: true });
  const local = new MemoryMediaStore();
  const store = new UploadingMediaStore(server, local);

  const key = await store.put(photo());
  assert.ok(server.items.has(key));
  assert.equal(local.items.size, 0);
});

check('a photo only this browser has is uploaded under its own key, once', async () => {
  const server = new MemoryMediaStore({ canUpload: true });
  const local = new MemoryMediaStore();
  local.items.set('photo_old', photo('taken before the server kept photos'));
  const store = new UploadingMediaStore(server, local);

  const shown = await store.get('photo_old');
  assert.equal(await shown.text(), 'taken before the server kept photos');
  assert.deepEqual(server.uploads, ['photo_old'], 'the key its markup records — so the markup still finds it');

  await store.get('photo_old');
  assert.deepEqual(server.uploads, ['photo_old'], 'and only once');
});

check('a failed upload still shows the photo, and is tried again', async () => {
  const server = new MemoryMediaStore({ canUpload: true });
  server.failUploads = true;
  const local = new MemoryMediaStore();
  local.items.set('photo_old', photo());
  const store = new UploadingMediaStore(server, local);

  assert.ok(await store.get('photo_old'), 'shown from this device');
  server.failUploads = false;
  await store.get('photo_old');
  assert.deepEqual(server.uploads, ['photo_old'], 'the second time it goes up');
});

check('with the server unreachable, this device\'s photos still show, and nothing is uploaded', async () => {
  const server = new MemoryMediaStore({ canUpload: true });
  server.down = true;
  const local = new MemoryMediaStore();
  local.items.set('photo_old', photo());
  const store = new UploadingMediaStore(server, local);

  assert.ok(await store.get('photo_old'));
  assert.deepEqual(server.uploads, []);
});

check('a photo nobody has is null — the placeholder', async () => {
  const store = new UploadingMediaStore(new MemoryMediaStore({ canUpload: true }), new MemoryMediaStore());
  assert.equal(await store.get('photo_nowhere'), null);
});

check('the server store must be able to upload under an existing key', () => {
  assert.throws(() => new UploadingMediaStore(new MemoryMediaStore(), new MemoryMediaStore()), /upload under an existing key/);
});

// --- run --------------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message.split('\n').join('\n        ')}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} server photo checks passed.`);
process.exit(failed === 0 ? 0 : 1);
