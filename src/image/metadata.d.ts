export function jpegOrientation(bytes: Uint8Array): number;
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array;
export function stripPngMetadata(bytes: Uint8Array): Uint8Array;
export function stripPhotoMetadata(bytes: Uint8Array, mime: string): Uint8Array;
