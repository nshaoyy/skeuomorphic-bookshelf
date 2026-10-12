// SPDX-License-Identifier: AGPL-3.0-only
// Pure helpers (no DOM, no imports) shared by the browser upload code and the Node tests.
export const uploadPixelLimit = 12_600_000;
export const uploadByteTarget = 9 * 1024 * 1024;
const progressiveReencodeAbove = 3_000_000;

export function jpegIsProgressive(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return false;
    while (at < bytes.length && bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || marker === 0xd9) return false;
    if ([0xc2, 0xc6, 0xca, 0xce].includes(marker)) return true;
    if (at + 2 > bytes.length) return false;
    at += (bytes[at] << 8) | bytes[at + 1];
  }
  return false;
}

export function planUpload({ width, height, size, type, progressive }, pixelLimit = uploadPixelLimit, byteTarget = uploadByteTarget) {
  const pixels = width * height, scale = pixels > pixelLimit ? Math.sqrt(pixelLimit / pixels) : 1;
  let w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
  while (w * h > pixelLimit) { w--; h = Math.max(1, Math.floor(height * w / width)); }
  const reencode = scale < 1 || size > byteTarget || (type === 'image/jpeg' && progressive && pixels > progressiveReencodeAbove);
  return { reencode, width: reencode ? w : width, height: reencode ? h : height };
}
