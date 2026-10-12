// SPDX-License-Identifier: AGPL-3.0-only
// Test fixtures: a synthetic shelf photo and a local fake OpenAI-compatible provider. No network.
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { encode as encodePng } from 'fast-png';
import { loadConfig, type Config } from '../src/config.ts';

/** Two shelf rows of coloured spines on a dark background; returns the JPEG and each spine's quad (0-1000). */
export function shelfPhoto(count: number) {
  const W = 1200, H = 900, data = new Uint8Array(W * H * 4).fill(30);
  for (let p = 3; p < data.length; p += 4) data[p] = 255;
  const perRow = Math.ceil(count / 2), quads: number[][][] = [];
  for (let i = 0; i < count; i++) {
    const row = i < perRow ? 0 : 1, col = row ? i - perRow : i;
    const x0 = 40 + col * 90, x1 = x0 + 70, y0 = row ? 480 : 40, y1 = y0 + 380;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * W + x) * 4; data[p] = (i * 53) % 256; data[p + 1] = (i * 97) % 256; data[p + 2] = 200; }
    const q = (x: number, y: number) => [Math.round(x / (W - 1) * 1000), Math.round(y / (H - 1) * 1000)];
    quads.push([q(x0, y0), q(x1, y0), q(x1, y1), q(x0, y1)]);
  }
  return { bytes: new Uint8Array(jpeg.encode({ width: W, height: H, data }, 90).data), quads };
}

export type FakeOptions = { quads: number[][][]; titles: (string | null)[]; checkPass?: (n: number) => boolean; detectStatus?: number };
/** Fake provider: /chat/completions answers by prompt type; /images/generations returns a PNG. */
export async function fakeProvider(opts: FakeOptions) {
  const log: { kind: string; body: any }[] = [];
  let identifyN = 0, checkN = 0;
  const reply = (res: any, obj: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const chat = (text: string) => ({ choices: [{ message: { content: text } }] });
  const server: Server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(raw), prompt: string = body.messages[0].content[0].text;
      if (prompt.includes('Find every book')) {
        log.push({ kind: 'detect', body });
        if (opts.detectStatus) { res.writeHead(opts.detectStatus); res.end('provider down'); return; }
        return reply(res, chat('```json\n' + JSON.stringify({ books: [...opts.quads].reverse().map(quad => ({ quad })) }) + '\n```'));
      }
      if (prompt.includes('Read the title')) {
        log.push({ kind: 'identify', body });
        const title = opts.titles[identifyN++] ?? null;
        return reply(res, chat(JSON.stringify(title ? { readable: true, title, author: 'Author' } : { readable: false, title: null, author: null })));
      }
      if (prompt.includes('Image 1 is a photo crop')) { log.push({ kind: 'check', body }); const pass = opts.checkPass ? opts.checkPass(checkN++) : true; return reply(res, chat(JSON.stringify({ pass, reason: pass ? 'ok' : 'title changed' }))); }
    }
    if (req.url === '/v1/images/generations') {
      log.push({ kind: 'image', body: JSON.parse(raw) });
      const png = encodePng({ width: 100, height: 400, data: new Uint8Array(100 * 400 * 4).fill(180), channels: 4, depth: 8 });
      return reply(res, { data: [{ b64_json: Buffer.from(png).toString('base64') }] });
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  return { url: `http://127.0.0.1:${port}/v1`, log, close: () => new Promise<void>(r => server.close(() => r())) };
}

export function testConfig(providerUrl: string, extra: Record<string, string> = {}): Config {
  return loadConfig({ DATA_DIR: mkdtempSync(path.join(tmpdir(), 'bookshelf-test-')), VISION_BASE_URL: providerUrl, VISION_MODEL: 'fake-vision',
    IMAGE_API_STYLE: 'json-image', IMAGE_BASE_URL: providerUrl, IMAGE_MODEL: 'fake-image', ...extra });
}
