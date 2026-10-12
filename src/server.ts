// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.ts';
import { Store, type BookStatus } from './db.ts';
import { Providers } from './providers.ts';
import { loadPrompts } from './prompts.ts';
import { startWorker, type Deps } from './pipeline.ts';
import { stripPhotoMetadata } from './image/metadata.js';
import { inspectBookPhoto } from './image/pixels.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_UPLOAD = 10 * 1024 * 1024; // same bound as the decoder; the browser downsizes larger photos first
const statics: Record<string, [string, string]> = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/upload.js': ['public/upload.js', 'text/javascript; charset=utf-8'],
  '/upload-plan.js': ['public/upload-plan.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/lib/metadata.js': ['src/image/metadata.js', 'text/javascript; charset=utf-8'],
};
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');

async function body(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Upload too large'); chunks.push(chunk); }
  return new Uint8Array(Buffer.concat(chunks));
}
async function jsonBody(req: IncomingMessage) {
  try { return JSON.parse(Buffer.from(await body(req, 64 * 1024)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Invalid JSON'); }
}

const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest();
function authorized(req: IncomingMessage, config: Config) {
  if (!config.password) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(sha(password), sha(config.password));
}
function requireWrite(req: IncomingMessage, config: Config) {
  if (!authorized(req, config)) throw new HttpError(401, 'Password required');
  // Browsers always send Origin on cross-site writes; reject anything not from this server.
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request rejected');
}

const statuses: BookStatus[] = ['unread', 'reading', 'read'];
function bookPatch(input: any) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid book update');
  const out: Record<string, string | null> = {};
  const text = (k: string, max: number, required = false) => {
    if (!(k in input)) return;
    const v = input[k] === null ? null : String(input[k]).trim().slice(0, max);
    if (required && !v) throw new HttpError(400, `${k} cannot be empty`);
    out[k] = v || null;
  };
  text('title', 200, true); text('author', 200); text('note', 2000);
  for (const k of ['started', 'finished']) if (k in input) {
    if (input[k] !== null && input[k] !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(input[k]))) throw new HttpError(400, `${k} must be YYYY-MM-DD`);
    out[k] = input[k] || null;
  }
  if ('status' in input) { if (!statuses.includes(input.status)) throw new HttpError(400, 'Invalid status'); out.status = input.status; }
  return out;
}

export function createApp(config: Config, deps: Deps): Server {
  const { store } = deps;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      const canRead = config.publicShelf || authorized(req, config);
      if (req.method === 'GET' && statics[url.pathname]) {
        if (!canRead) return send(res, 401, 'Password required', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Skeuomorphic Bookshelf"' });
        const [file, type] = statics[url.pathname];
        return send(res, 200, readFileSync(path.join(root, file)), type, { 'Cache-Control': 'no-cache' });
      }
      if (!canRead) throw new HttpError(401, 'Password required');

      // Only generated spine images are ever served; original photos stay private on disk.
      const spine = url.pathname.match(/^\/spines\/([0-9a-f-]{36}\.(?:jpg|png))$/);
      if (req.method === 'GET' && spine) {
        if (!store.books().some(b => b.spine_file === spine[1])) throw new HttpError(404, 'Not found');
        return send(res, 200, readFileSync(path.join(store.filesDir, spine[1])), spine[1].endsWith('.png') ? 'image/png' : 'image/jpeg', { 'Cache-Control': 'public, max-age=31536000, immutable' });
      }
      if (req.method === 'GET' && url.pathname === '/api/shelf') {
        return json(res, 200, { books: store.books(), jobs: store.recentJobs(10), canEdit: authorized(req, config), limits: { booksPerPhoto: config.maxBooksPerPhoto, photosPerDay: config.maxPhotosPerDay } });
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && jobMatch) { const job = store.job(jobMatch[1]); if (!job) throw new HttpError(404, 'Not found'); return json(res, 200, job); }

      if (req.method === 'POST' && url.pathname === '/api/photos') {
        requireWrite(req, config);
        const mime = String(req.headers['content-type'] ?? '').split(';')[0];
        if (!['image/jpeg', 'image/png'].includes(mime)) throw new HttpError(415, 'Use a JPEG or PNG photo');
        // Location and other capture metadata never reach the disk, whichever client uploaded.
        const bytes = stripPhotoMetadata(await body(req, MAX_UPLOAD), mime);
        try { inspectBookPhoto(bytes, mime); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Unreadable photo'); }
        const digest = createHash('sha256').update(bytes).digest('hex');
        const existing = store.photoBySha(digest);
        if (existing) return json(res, 200, { jobId: store.jobForPhoto(existing.id)?.id, duplicate: true });
        if (store.photosSince(Date.now() - 86_400_000) >= config.maxPhotosPerDay) throw new HttpError(429, `Daily limit of ${config.maxPhotosPerDay} photos reached`);
        const id = randomUUID(), file = `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`;
        writeFileSync(path.join(store.filesDir, file), bytes);
        store.addPhoto({ id, file, mime, sha256: digest });
        const jobId = randomUUID(); store.addJob(jobId, id);
        return json(res, 202, { jobId });
      }
      const bookMatch = url.pathname.match(/^\/api\/books\/([0-9a-f-]{36})$/);
      if (bookMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        requireWrite(req, config);
        if (!store.book(bookMatch[1])) throw new HttpError(404, 'Not found');
        if (req.method === 'DELETE') { store.deleteBook(bookMatch[1]); return json(res, 200, { ok: true }); }
        store.updateBook(bookMatch[1], bookPatch(await jsonBody(req)));
        return json(res, 200, store.book(bookMatch[1]));
      }
      if (req.method === 'PUT' && url.pathname === '/api/books/order') {
        requireWrite(req, config);
        const { ids } = await jsonBody(req), known = new Set(store.books().map(b => b.id));
        if (!Array.isArray(ids) || ids.length !== known.size || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) throw new HttpError(400, 'Order must list every book exactly once');
        store.reorder(ids); return json(res, 200, { ok: true });
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { error: e instanceof HttpError ? e.message : 'Internal error' });
    }
  });
}

// Entry point: `node src/server.ts` (reads .env if present; real environment variables win).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envFile = path.join(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const config = loadConfig();
  const store = new Store(config.dataDir);
  const deps: Deps = { store, providers: new Providers(config), prompts: loadPrompts(config.dataDir), config, log: m => console.log(m) };
  startWorker(deps);
  createApp(config, deps).listen(config.port, config.host, () => console.log(`Skeuomorphic Bookshelf on http://${config.host}:${config.port}`));
}
