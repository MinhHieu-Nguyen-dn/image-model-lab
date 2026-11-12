/**
 * Minimal image header parsing (PNG, JPEG, WebP, GIF, BMP) to read pixel
 * dimensions without a decoding dependency.
 */

export interface ImageInfo {
  format: "png" | "jpeg" | "webp" | "gif" | "bmp";
  width: number;
  height: number;
}

export function extForFormat(format: ImageInfo["format"]): string {
  return format === "jpeg" ? "jpg" : format;
}

function parsePng(b: Uint8Array, v: DataView): ImageInfo | null {
  if (b.length < 24) return null;
  return { format: "png", width: v.getUint32(16), height: v.getUint32(20) };
}

/** Walks JPEG segments until a Start-Of-Frame marker carrying the dimensions. */
function parseJpeg(b: Uint8Array, v: DataView): ImageInfo | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { format: "jpeg", height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

function parseWebp(b: Uint8Array, v: DataView): ImageInfo | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8 ") return { format: "webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = v.getUint32(21, true);
    return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { format: "webp", width: w, height: h };
  }
  return null;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return parsePng(b, v);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return parseJpeg(b, v);
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    return parseWebp(b, v);
  }
  if (b.length >= 10 && String.fromCharCode(...b.subarray(0, 3)) === "GIF") {
    return { format: "gif", width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { format: "bmp", width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)) };
  }
  return null;
}
