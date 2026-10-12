// SPDX-License-Identifier: AGPL-3.0-only
/** Corners in 0–1000 normalized image coordinates, clockwise from top-left of the printed spine. */
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

/** Rejects non-numeric, out-of-range, self-intersecting, reversed or collapsed quads. */
export function validateQuad(value: unknown): Quad {
  if (!Array.isArray(value) || value.length !== 4 || value.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000)))
    throw new Error('Invalid spine corner coordinates.');
  const q = value as Quad;
  if (q.some((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]) <= 0)) throw new Error('Spine corners are not a clockwise convex quad.');
  const area = q.reduce((sum, p, i) => sum + p[0] * q[(i + 1) % 4][1] - p[1] * q[(i + 1) % 4][0], 0) / 2;
  if (area < 1) throw new Error('Spine region is too small.');
  return q;
}

/** Reading order: shelf rows top to bottom (overlapping rows absorb perspective), then left to right. */
export function readingOrder<T extends { quad: number[][] }>(items: T[]): T[] {
  const extent = (i: T) => ({ top: Math.min(...i.quad.map(p => p[1])), bottom: Math.max(...i.quad.map(p => p[1])), left: Math.min(...i.quad.map(p => p[0])) });
  const rows: { top: number; bottom: number; items: T[] }[] = [];
  for (const item of [...items].sort((a, b) => extent(a).top - extent(b).top)) {
    const e = extent(item);
    const row = rows.find(r => Math.min(r.bottom, e.bottom) - Math.max(r.top, e.top) >= 0.5 * Math.min(r.bottom - r.top, e.bottom - e.top));
    if (row) { row.items.push(item); row.top = Math.min(row.top, e.top); row.bottom = Math.max(row.bottom, e.bottom); }
    else rows.push({ ...e, items: [item] });
  }
  return rows.sort((a, b) => a.top - b.top).flatMap(r => r.items.sort((a, b) => extent(a).left - extent(b).left));
}
