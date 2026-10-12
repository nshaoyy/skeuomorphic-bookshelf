// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../src/db.ts';
import { Providers } from '../src/providers.ts';
import { defaultPrompts } from '../src/prompts.ts';
import { processJob, type Deps } from '../src/pipeline.ts';
import { createApp } from '../src/server.ts';
import { fakeProvider, shelfPhoto, testConfig } from './helpers.ts';

function withGps(jpegBytes: Uint8Array) {
  const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, ...ascii('GPSLatitude=31.2304N')];
  const payload = [...ascii('Exif'), 0, 0, ...tiff], app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
  return new Uint8Array([...jpegBytes.subarray(0, 2), ...app1, ...jpegBytes.subarray(2)]);
}

async function boot(env: Record<string, string> = {}) {
  const photo = shelfPhoto(3), provider = await fakeProvider({ quads: photo.quads, titles: ['A', 'B', 'C'] });
  const config = testConfig(provider.url, { SHELF_PASSWORD: 'pw', MAX_PHOTOS_PER_DAY: '2', ...env });
  const store = new Store(config.dataDir), deps: Deps = { store, providers: new Providers(config), prompts: defaultPrompts, config };
  const server = createApp(config, deps);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('me:pw').toString('base64') };
  const close = async () => { await new Promise<void>(r => server.close(() => r())); await provider.close(); };
  return { base, auth, store, deps, photo, close };
}

test('reads and writes require the password unless the shelf is public; wrong password rejected', async () => {
  const s = await boot();
  assert.equal((await fetch(`${s.base}/api/shelf`)).status, 401);
  assert.equal((await fetch(`${s.base}/`)).headers.get('www-authenticate'), 'Basic realm="Skeuomorphic Bookshelf"');
  assert.equal((await fetch(`${s.base}/api/shelf`, { headers: { Authorization: 'Basic ' + Buffer.from('me:nope').toString('base64') } })).status, 401);
  const ok = await (await fetch(`${s.base}/api/shelf`, { headers: s.auth })).json();
  assert.equal(ok.canEdit, true); assert.deepEqual(ok.books, []);
  await s.close();
  const p = await boot({ SHELF_PUBLIC: 'true' });
  const pub = await (await fetch(`${p.base}/api/shelf`)).json();
  assert.equal(pub.canEdit, false);
  assert.equal((await fetch(`${p.base}/api/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Blob([p.photo.bytes as BlobPart]) })).status, 401);
  await p.close();
});

test('upload strips GPS before storing, de-duplicates, enforces the daily limit, and blocks cross-site writes', async () => {
  const s = await boot();
  const post = (bytes: Uint8Array, headers: Record<string, string> = {}) => fetch(`${s.base}/api/photos`, { method: 'POST', headers: { ...s.auth, 'Content-Type': 'image/jpeg', ...headers }, body: new Blob([bytes as BlobPart]) });
  const first = await post(withGps(s.photo.bytes)); assert.equal(first.status, 202);
  const { jobId } = await first.json();
  const stored = readdirSync(s.store.filesDir).map(f => readFileSync(path.join(s.store.filesDir, f)).toString('latin1'));
  assert.equal(stored.length, 1); assert.ok(!stored[0].includes('GPSLatitude'), 'no GPS on disk');
  const again = await (await post(withGps(s.photo.bytes))).json();
  assert.deepEqual(again, { jobId, duplicate: true });
  assert.equal((await post(shelfPhoto(4).bytes, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(shelfPhoto(5).bytes)).status, 202);
  const limited = await post(shelfPhoto(6).bytes); assert.equal(limited.status, 429); assert.match((await limited.json()).error, /Daily limit of 2/);
  assert.equal((await post(new Uint8Array([1, 2, 3]))).status, 400);
  assert.equal((await fetch(`${s.base}/api/photos`, { method: 'POST', headers: { ...s.auth, 'Content-Type': 'image/gif' }, body: 'x' })).status, 415);
  await s.close();
});

test('end to end: processed books are served; spines public via path, originals never; edit, order and delete', async () => {
  const s = await boot();
  const { jobId } = await (await fetch(`${s.base}/api/photos`, { method: 'POST', headers: { ...s.auth, 'Content-Type': 'image/jpeg' }, body: new Blob([s.photo.bytes as BlobPart]) })).json();
  await processJob(s.store.claimJob()!, s.deps);
  assert.equal((await (await fetch(`${s.base}/api/jobs/${jobId}`, { headers: s.auth })).json()).status, 'completed');
  const { books } = await (await fetch(`${s.base}/api/shelf`, { headers: s.auth })).json();
  assert.deepEqual(books.map((b: any) => b.title), ['A', 'B', 'C']);
  const spine = await fetch(`${s.base}/spines/${books[0].spine_file}`, { headers: s.auth });
  assert.equal(spine.status, 200); assert.equal(spine.headers.get('content-type'), 'image/png');
  const photoFile = readdirSync(s.store.filesDir).find(f => !books.some((b: any) => b.spine_file === f))!;
  assert.equal((await fetch(`${s.base}/spines/${photoFile}`, { headers: s.auth })).status, 404, 'original photo is not served');
  const patch = (id: string, body: unknown) => fetch(`${s.base}/api/books/${id}`, { method: 'PATCH', headers: { ...s.auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const updated = await (await patch(books[0].id, { status: 'read', finished: '2026-10-01', note: 'good', position: 99, title: ' A2 ' })).json();
  assert.equal(updated.status, 'read'); assert.equal(updated.title, 'A2'); assert.equal(updated.position, 0, 'unknown fields ignored');
  assert.equal((await patch(books[0].id, { status: 'burned' })).status, 400);
  assert.equal((await patch(books[0].id, { finished: 'yesterday' })).status, 400);
  assert.equal((await patch(books[0].id, { title: '' })).status, 400);
  const order = (ids: string[]) => fetch(`${s.base}/api/books/order`, { method: 'PUT', headers: { ...s.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  assert.equal((await order([books[2].id, books[0].id])).status, 400);
  assert.equal((await order([books[2].id, books[0].id, books[1].id])).status, 200);
  assert.equal((await fetch(`${s.base}/api/books/${books[1].id}`, { method: 'DELETE', headers: s.auth })).status, 200);
  const after = await (await fetch(`${s.base}/api/shelf`, { headers: s.auth })).json();
  assert.deepEqual(after.books.map((b: any) => b.title), ['C', 'A2']);
  await s.close();
});

test('pages carry a strict CSP and anti-framing headers; unknown routes 404', async () => {
  const s = await boot();
  const res = await fetch(`${s.base}/`, { headers: s.auth });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy')!, /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${s.base}/lib/metadata.js`, { headers: s.auth })).status, 200);
  assert.equal((await fetch(`${s.base}/../package.json`, { headers: s.auth })).status, 404);
  assert.equal((await fetch(`${s.base}/spines/..%2Fshelf.db`, { headers: s.auth })).status, 404);
  await s.close();
});

test('refuses to listen publicly without a password', async () => {
  const p = await fakeProvider({ quads: [], titles: [] });
  assert.throws(() => testConfig(p.url, { HOST: '0.0.0.0' }), /without SHELF_PASSWORD/);
  await p.close();
});
