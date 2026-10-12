// SPDX-License-Identifier: AGPL-3.0-only
import jpeg from 'jpeg-js';
import type { Raster } from './pixels.ts';

/** Box-filter downscale so the longest side is at most maxSide (never upscales). */
export function downscale(r: Raster, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(r.width, r.height));
  if (scale === 1) return r;
  const w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(r.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(r.width, Math.floor((x + 1) / scale)));
      const sum = [0, 0, 0, 0]; let n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { const p = (sy * r.width + sx) * 4; for (let k = 0; k < 4; k++) sum[k] += r.data[p + k]; n++; }
      for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = Math.round(sum[k] / n);
    }
  }
  return { width: w, height: h, data };
}

export function encodeJpeg(r: Raster, quality = 88): Uint8Array {
  return new Uint8Array(jpeg.encode({ width: r.width, height: r.height, data: r.data }, quality).data);
}

export const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
