export class UnsupportedBaselineJPEGError extends Error {
  readonly code: 'JPEG_BASELINE_UNSUPPORTED';
  readonly reason: string;
  constructor(reason: string);
}
export function decodeBaselineJPEG(bytes: Uint8Array, options?: {
  maxMemoryUsageInMB?: number;
  maxResolutionInMP?: number;
  orientation?: number;
}): {
  width: number;
  height: number;
  data: Uint8Array;
  decodeEvidence: {
    revision: string;
    allocatedBytes: number;
    maxMemoryUsageBytes: number;
    mcuRows: number;
    sampling: number[][];
    orientation: number;
    fullImageCopies: number;
    inputCopied: boolean;
  };
};
