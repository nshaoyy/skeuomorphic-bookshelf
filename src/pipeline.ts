// SPDX-License-Identifier: AGPL-3.0-only
// Photo → books. One job per uploaded photo; progress is saved after every book so a restart
// resumes where it stopped and never repeats a finished (paid) step.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Job, JobItem, Store } from './db.ts';
import type { Prompts } from './prompts.ts';
import { Providers, type Image } from './providers.ts';
import { decodeBookPhoto, extractBook, type Raster } from './image/pixels.ts';
import { downscale, encodeJpeg } from './image/codec.ts';
import { readingOrder, validateQuad, type Quad } from './image/geometry.ts';

export type Deps = { store: Store; providers: Providers; prompts: Prompts; config: Config; log?: (msg: string) => void };

const jpegImage = (r: Raster, maxSide: number): Image => ({ bytes: encodeJpeg(downscale(r, maxSide)), mime: 'image/jpeg' });

/** Validates the detector's reply; invalid quads are dropped rather than failing the photo. */
export function parseDetection(reply: any): Quad[] {
  if (!reply || !Array.isArray(reply.books)) throw new Error('Detector reply has no "books" array');
  const quads: Quad[] = [];
  for (const b of reply.books) { try { quads.push(validateQuad(b?.quad)); } catch { /* skip malformed spine */ } }
  return quads;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

async function detect(job: Job, photo: Raster, d: Deps) {
  const quads = parseDetection(await d.providers.vision(d.prompts.detect, [jpegImage(photo, 2048)], 4000));
  const ordered = readingOrder(quads.map((quad, i) => ({ id: `b${i + 1}`, quad })));
  job.detected = ordered.length;
  job.items = ordered.map((b, i): JobItem => i < d.config.maxBooksPerPhoto
    ? { id: b.id, quad: b.quad, state: 'pending' }
    : { id: b.id, quad: b.quad, state: 'skipped', error: `Over the per-photo limit of ${d.config.maxBooksPerPhoto} books` });
  d.store.saveJob(job);
}

function saveFile(d: Deps, bytes: Uint8Array, ext: 'jpg' | 'png') {
  const name = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(d.store.filesDir, name), bytes);
  return name;
}

async function processBook(job: Job, item: JobItem, photo: Raster, d: Deps) {
  const crop = extractBook(photo, item.quad as Quad);
  const cropImage = jpegImage(crop, 1600);

  const id = await d.providers.vision(d.prompts.identify, [cropImage], 400);
  const title = cleanText(id?.title, 200), author = cleanText(id?.author, 200);
  if (id?.readable === false || !title) { item.state = 'failed'; item.error = 'Spine text could not be read'; return; }
  item.title = title;
  if (d.store.findBookByTitle(title)) { item.state = 'duplicate'; item.error = 'Already on the shelf'; return; }

  const generated = await d.providers.spine(d.prompts.spine, cropImage);
  let spine: { bytes: Uint8Array; ext: 'jpg' | 'png'; width: number; height: number };
  if (generated) {
    const check = await d.providers.vision(d.prompts.check, [cropImage, generated], 300);
    if (check?.pass !== true) { item.state = 'failed'; item.error = `Quality check failed: ${cleanText(check?.reason, 200) ?? 'no reason given'}`; return; }
    const r = decodeBookPhoto(generated.bytes, generated.mime);
    spine = { bytes: generated.bytes, ext: generated.mime === 'image/png' ? 'png' : 'jpg', width: r.width, height: r.height };
  } else {
    const r = downscale(crop, 1600);
    spine = { bytes: encodeJpeg(r, 90), ext: 'jpg', width: r.width, height: r.height };
  }
  const bookId = randomUUID();
  d.store.addBook({ id: bookId, title, author, spine_file: saveFile(d, spine.bytes, spine.ext), width: spine.width, height: spine.height, photo_id: job.photo_id });
  item.state = 'admitted'; item.bookId = bookId;
}

export async function processJob(job: Job, d: Deps) {
  try {
    const meta = d.store.photo(job.photo_id);
    if (!meta) throw new Error('Photo file record is missing');
    const photo = decodeBookPhoto(new Uint8Array(readFileSync(path.join(d.store.filesDir, meta.file))), meta.mime);
    if (!job.items.length) await detect(job, photo, d);
    for (const item of job.items) {
      if (item.state !== 'pending') continue;
      try { await processBook(job, item, photo, d); }
      catch (e) { item.state = 'failed'; item.error = e instanceof Error ? e.message : 'Processing failed'; }
      d.store.saveJob(job);
    }
    job.status = 'completed'; job.error = null;
  } catch (e) {
    job.status = 'failed'; job.error = e instanceof Error ? e.message : 'Processing failed';
  }
  d.store.saveJob(job);
  d.log?.(`job ${job.id}: ${job.status}${job.error ? ` (${job.error})` : ''}, ${job.items.filter(i => i.state === 'admitted').length} admitted`);
}

/** Single in-process worker: jobs run one at a time, which also bounds concurrent provider spend. */
export function startWorker(d: Deps, intervalMs = 1000) {
  d.store.requeueInterrupted();
  let busy = false, stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try { for (let job = d.store.claimJob(); job && !stopped; job = d.store.claimJob()) await processJob(job, d); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return { stop() { stopped = true; clearInterval(timer); }, tick };
}
