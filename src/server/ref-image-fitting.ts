/**
 * Makes an uploaded reference image acceptable to Model Studio.
 * Documented input limits: <= 10 MB per image, each side 1..8000 px, longer side <= 10x the shorter.
 * Images that already fit are returned untouched; anything else is auto-oriented, scaled down
 * (never up) and re-encoded until it fits, so the user never has to re-upload a smaller file.
 */
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { HttpError } from "./http-utils.ts";

/** Raw size we allow on the wire. Base64 adds ~33%, so 7 MB stays under 10 MB even if the limit counts the encoded string. */
export const SEND_MAX_BYTES = 7 * 1024 * 1024;
export const SEND_MAX_SIDE = 8000;
export const SEND_MAX_ASPECT = 10;
/** Longest-side steps tried in order; 4096 keeps detail well above the 2048 px the models work best at. */
const SIDE_LADDER = [4096, 3072, 2048, 1536, 1024];
const QUALITY = 90;

export interface ImageSummary { width: number; height: number; bytes: number }

export interface FitResult {
  bytes: Uint8Array;
  /** File extension / MIME of `bytes`; differs from the input only when the image was re-encoded. */
  ext: string;
  mime: string;
  resized: boolean;
  from: ImageSummary;
  to: ImageSummary;
}

/** Pixel size as displayed, i.e. after applying the EXIF orientation. */
function orientedSize(width: number, height: number, orientation?: number): { width: number; height: number } {
  return orientation && orientation >= 5 ? { width: height, height: width } : { width, height };
}

export async function fitReferenceImage(input: Uint8Array, ext: string, mime: string): Promise<FitResult> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new HttpError(400, "The image could not be decoded; it may be corrupt");
  }
  if (!meta.width || !meta.height) throw new HttpError(400, "The image could not be decoded; it may be corrupt");
  const { width, height } = orientedSize(meta.width, meta.height, meta.orientation);
  const from = { width, height, bytes: input.byteLength };

  // Scaling cannot repair an extreme aspect ratio without cropping or padding, so say so plainly.
  if (Math.max(width, height) / Math.min(width, height) > SEND_MAX_ASPECT) {
    throw new HttpError(400, `Image is ${width}×${height}; Model Studio requires the longer side to be at most ${SEND_MAX_ASPECT}× the shorter side`);
  }
  if (input.byteLength <= SEND_MAX_BYTES && width <= SEND_MAX_SIDE && height <= SEND_MAX_SIDE) {
    return { bytes: input, ext, mime, resized: false, from, to: from };
  }

  // Keep transparency by using WebP for images with an alpha channel; everything else becomes JPEG.
  const keepsAlpha = meta.hasAlpha === true;
  const outExt = keepsAlpha ? "webp" : "jpg";
  const outMime = keepsAlpha ? "image/webp" : "image/jpeg";
  const longest = Math.max(width, height);
  const first = Math.min(longest, SIDE_LADDER[0]);
  const sides = [first, ...SIDE_LADDER.filter((s) => s < first)];

  for (const side of sides) {
    let pipeline = sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb");
    pipeline = keepsAlpha ? pipeline.webp({ quality: QUALITY }) : pipeline.jpeg({ quality: QUALITY });
    let out: { data: Buffer; info: OutputInfo };
    try {
      out = await pipeline.toBuffer({ resolveWithObject: true });
    } catch {
      throw new HttpError(400, "The image could not be decoded; it may be corrupt");
    }
    if (out.data.byteLength <= SEND_MAX_BYTES) {
      const bytes = new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
      return {
        bytes, ext: outExt, mime: outMime, resized: true, from,
        to: { width: out.info.width, height: out.info.height, bytes: out.data.byteLength },
      };
    }
  }
  throw new HttpError(422, `Image could not be reduced below ${SEND_MAX_BYTES / 1024 / 1024} MB`);
}
