// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { stripJpegMetadata, jpegOrientation } from '../src/image/metadata.js';
import { validateQuad, readingOrder } from '../src/image/geometry.ts';
import { decodeBookPhoto, extractBook } from '../src/image/pixels.ts';
import { downscale } from '../src/image/codec.ts';
import { planUpload, jpegIsProgressive, uploadPixelLimit } from '../public/upload-plan.js';

const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
function jpegWithExif(orientation: number) {
  const w = 40, h = 20, data = new Uint8Array(w * h * 4);
  for (let p = 0; p < data.length; p += 4) { const x = (p / 4) % w; data[p] = x < 20 ? 250 : 5; data[p + 2] = x < 20 ? 5 : 250; data[p + 3] = 255; }
  const base = new Uint8Array(jpeg.encode({ width: w, height: h, data }, 95).data);
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, ...ascii('GPSLatitude=31.2N')];
  const payload = [...ascii('Exif'), 0, 0, ...tiff], app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
  const at = 4 + ((base[4] << 8) | base[5]);
  return new Uint8Array([...base.subarray(0, at), ...app1, ...base.subarray(at)]);
}

test('metadata: GPS removed losslessly, orientation kept, pixels identical after decode', () => {
  const src = jpegWithExif(6), out = stripJpegMetadata(src);
  assert.ok(Buffer.from(src).toString('latin1').includes('GPSLatitude') && !Buffer.from(out).toString('latin1').includes('GPSLatitude'));
  assert.equal(jpegOrientation(out), 6);
  const a = decodeBookPhoto(src, 'image/jpeg'), b = decodeBookPhoto(out, 'image/jpeg');
  assert.deepEqual([b.width, b.height], [20, 40]); assert.ok(Buffer.from(a.data).equals(Buffer.from(b.data)));
});

test('geometry: rejects malformed quads; reading order is rows top-down then left-right', () => {
  assert.throws(() => validateQuad([[0, 0], [10, 0], [10, 10]]));
  assert.throws(() => validateQuad([[0, 0], [0, 10], [10, 10], [10, 0]]), /clockwise/);
  assert.throws(() => validateQuad([[0, 0], [2000, 0], [10, 10], [0, 10]]));
  const box = (x: number, y: number) => ({ id: `${x},${y}`, quad: [[x, y], [x + 10, y], [x + 10, y + 100], [x, y + 100]] });
  assert.deepEqual(readingOrder([box(50, 500), box(10, 8), box(30, 0), box(5, 505)]).map(b => b.id), ['10,8', '30,0', '5,505', '50,500']);
});

test('crop: perspective extraction of an upright spine; downscale keeps aspect', () => {
  const r = { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4).fill(255) };
  const c = extractBook(r, [[100, 100], [300, 100], [300, 900], [100, 900]]);
  assert.ok(c.height > c.width * 3);
  const d = downscale({ width: 4000, height: 1000, data: new Uint8Array(4000 * 1000 * 4) }, 1000);
  assert.deepEqual([d.width, d.height], [1000, 250]);
});

test('browser upload plan: 24 MP scaled under the server limit, 12 MP untouched, progressive detected', () => {
  const p = planUpload({ width: 5712, height: 4284, size: 6e6, type: 'image/jpeg', progressive: false });
  assert.ok(p.reencode && p.width * p.height <= uploadPixelLimit);
  assert.deepEqual(planUpload({ width: 4032, height: 3024, size: 4e6, type: 'image/jpeg', progressive: false }), { reencode: false, width: 4032, height: 3024 });
  const seg = (m: number, len: number) => [0xff, m, len >> 8, len & 255, ...new Array(len - 2).fill(0)];
  assert.equal(jpegIsProgressive(new Uint8Array([0xff, 0xd8, ...seg(0xe0, 16), ...seg(0xc2, 17), 0xff, 0xda])), true);
  assert.equal(jpegIsProgressive(new Uint8Array(jpeg.encode({ width: 8, height: 8, data: new Uint8Array(256) }, 80).data)), false);
});
