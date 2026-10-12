// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../src/db.ts';
import { Providers } from '../src/providers.ts';
import { defaultPrompts } from '../src/prompts.ts';
import { processJob, parseDetection } from '../src/pipeline.ts';
import { fakeProvider, shelfPhoto, testConfig } from './helpers.ts';

async function setup(count: number, titles: (string | null)[], extra: Record<string, string> = {}, fake: Partial<Parameters<typeof fakeProvider>[0]> = {}) {
  const photo = shelfPhoto(count), provider = await fakeProvider({ quads: photo.quads, titles, ...fake });
  const config = testConfig(provider.url, extra), store = new Store(config.dataDir);
  writeFileSync(path.join(store.filesDir, 'p1.jpg'), photo.bytes);
  store.addPhoto({ id: 'p1', file: 'p1.jpg', mime: 'image/jpeg', sha256: 'x' }); store.addJob('j1', 'p1');
  const deps = { store, providers: new Providers(config), prompts: defaultPrompts, config };
  return { provider, store, deps, run: async () => { await processJob(store.claimJob()!, deps); return store.job('j1')!; } };
}

test('12 spines with a 10-book cap: first 10 in reading order processed, 2 skipped, one duplicate, one unreadable', async () => {
  const titles = ['A', 'B', 'C', 'A', null, 'F', 'G', 'H', 'I', 'J'];
  const { provider, store, run } = await setup(12, titles);
  const job = await run();
  assert.equal(job.status, 'completed'); assert.equal(job.detected, 12);
  const states = job.items.map(i => i.state);
  assert.deepEqual(states.slice(0, 10), ['admitted', 'admitted', 'admitted', 'duplicate', 'failed', 'admitted', 'admitted', 'admitted', 'admitted', 'admitted']);
  assert.deepEqual(states.slice(10), ['skipped', 'skipped']);
  // Reading order: the fake detector returned spines reversed; top row (6 spines) must come first, left to right.
  const tops = job.items.map(i => i.quad[0][1]), lefts = job.items.slice(0, 6).map(i => i.quad[0][0]);
  assert.ok(tops.slice(0, 6).every(t => t < 100) && tops.slice(6).every(t => t > 500));
  assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b));
  assert.deepEqual(store.books().map(b => b.title), ['A', 'B', 'C', 'F', 'G', 'H', 'I', 'J']);
  // Spend: 1 detect + 10 identify; generation + check only for the 8 new readable books; nothing for skipped ones.
  const kinds = provider.log.map(l => l.kind);
  assert.equal(kinds.filter(k => k === 'detect').length, 1); assert.equal(kinds.filter(k => k === 'identify').length, 10);
  assert.equal(kinds.filter(k => k === 'image').length, 8); assert.equal(kinds.filter(k => k === 'check').length, 8);
  await provider.close();
});

test('failed quality check keeps the book off the shelf with the reason', async () => {
  const { provider, store, run } = await setup(2, ['A', 'B'], {}, { checkPass: n => n !== 1 });
  const job = await run();
  assert.deepEqual(job.items.map(i => i.state), ['admitted', 'failed']);
  assert.match(job.items[1].error!, /Quality check failed: title changed/);
  assert.equal(store.books().length, 1); await provider.close();
});

test('IMAGE_API_STYLE=none uses the straightened crop and makes no image or check calls', async () => {
  const { provider, store, run } = await setup(3, ['A', 'B', 'C'], { IMAGE_API_STYLE: 'none' });
  const job = await run();
  assert.equal(job.items.filter(i => i.state === 'admitted').length, 3);
  assert.ok(!provider.log.some(l => l.kind === 'image' || l.kind === 'check'));
  const b = store.books()[0]; assert.ok(b.height > b.width, 'upright spine crop');
  await provider.close();
});

test('resuming a job never repeats detection or finished books', async () => {
  const { provider, store, deps } = await setup(4, ['C', 'D']);
  const job = store.claimJob()!;
  const photo = shelfPhoto(4);
  job.detected = 4;
  job.items = photo.quads.map((quad, i) => ({ id: `b${i + 1}`, quad, state: i < 2 ? 'admitted' : 'pending' }));
  store.saveJob(job);
  await processJob(store.job('j1')!, deps);
  const kinds = provider.log.map(l => l.kind);
  assert.equal(kinds.filter(k => k === 'detect').length, 0); assert.equal(kinds.filter(k => k === 'identify').length, 2);
  assert.deepEqual(store.job('j1')!.items.map(i => i.state), ['admitted', 'admitted', 'admitted', 'admitted']);
  await provider.close();
});

test('provider outage during detection fails the job with a readable error, without leaking the key', async () => {
  const { provider, run } = await setup(2, [], { VISION_API_KEY: 'sk-secret-123' }, { detectStatus: 503 });
  const job = await run();
  assert.equal(job.status, 'failed'); assert.match(job.error!, /HTTP 503/); assert.ok(!job.error!.includes('sk-secret'));
  assert.equal(provider.log[0].body.model, 'fake-vision');
  await provider.close();
});

test('invalid quads from the detector are dropped, not fatal', () => {
  const quads = parseDetection({ books: [{ quad: [[0, 0], [10, 0], [10, 100], [0, 100]] }, { quad: [[0, 0], [10, 0]] }, { quad: 'x' }, {}] });
  assert.equal(quads.length, 1);
  assert.throws(() => parseDetection({ nope: true }), /books/);
});
