// SPDX-License-Identifier: AGPL-3.0-only
// Browser-side photo preparation: fits phone originals to the server limits (<=12.6 MP, <=9 MB,
// baseline JPEG) and removes location/capture metadata before anything leaves the device.
// Any failure falls back to the original file; the server strips metadata again and reports errors.
import { stripPhotoMetadata } from '/lib/metadata.js';
import { planUpload, jpegIsProgressive, uploadByteTarget } from '/upload-plan.js';

async function decode(file) {
  try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { source: b, width: b.width, height: b.height, close: () => b.close() }; } catch { /* fall back */ }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }; }
  catch (e) { URL.revokeObjectURL(url); throw e; }
}

export async function prepareUpload(file) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return file;
  try {
    const original = new Uint8Array(await file.arrayBuffer());
    const image = await decode(file);
    try {
      const plan = planUpload({ width: image.width, height: image.height, size: file.size, type: file.type, progressive: file.type === 'image/jpeg' && jpegIsProgressive(original) });
      if (!plan.reencode) {
        const clean = stripPhotoMetadata(original, file.type);
        return clean === original ? file : new File([clean], file.name, { type: file.type, lastModified: file.lastModified });
      }
      const canvas = document.createElement('canvas'); canvas.width = plan.width; canvas.height = plan.height;
      const ctx = canvas.getContext('2d'); if (!ctx) return file;
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image.source, 0, 0, plan.width, plan.height);
      const encode = q => new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
      let blob = await encode(0.92); if (blob && blob.size > uploadByteTarget) blob = await encode(0.85);
      canvas.width = canvas.height = 0;
      if (!blob || blob.size > uploadByteTarget) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
    } finally { image.close(); }
  } catch { return file; }
}
