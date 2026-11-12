/**
 * API tests for reference-image fitting: uploads above Model Studio's input limits
 * (10 MB, 8000 px per side, 10:1 aspect) are scaled down server-side instead of rejected.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import sharp from "sharp";
import { createHarness, noisePng, pngBytes, setupTask, type Harness } from "./helpers/test-harness.ts";

const MB = 1024 * 1024;
// Generating and re-encoding multi-megabyte images takes a few seconds.
setDefaultTimeout(30_000);
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

/** Reads a stored ref back through the public /files route. */
async function download(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(h.app.url + url)).arrayBuffer());
}

describe("reference image fitting", () => {
  test("an image that already fits is stored byte-for-byte and not flagged", async () => {
    const { tid } = await setupTask(h);
    const png = pngBytes(64, 48);
    const res = await h.upload(tid, "small.png", png);
    expect(res.status).toBe(201);
    expect(res.data.resized).toBeUndefined();
    expect(res.data.filename).toBe("small.png");
    expect(res.data.bytes).toBe(png.byteLength);
    expect(await download(res.data.url)).toEqual(png);
  });

  test("a PNG above 10 MB is accepted and stored as a JPEG under 7 MB", async () => {
    const { tid } = await setupTask(h);
    const big = await noisePng(2400, 2400, 3); // ~17 MB
    expect(big.byteLength).toBeGreaterThan(10 * MB);
    const res = await h.upload(tid, "photo.png", big);
    expect(res.status).toBe(201);
    expect(res.data.filename).toBe("photo.jpg");
    expect(res.data.mime).toBe("image/jpeg");
    expect(res.data.bytes).toBeLessThanOrEqual(7 * MB);
    expect(res.data.resized.from).toEqual({ width: 2400, height: 2400, bytes: big.byteLength });
    expect(res.data.resized.to.bytes).toBe(res.data.bytes);
    const stored = await download(res.data.url);
    expect(stored.byteLength).toBe(res.data.bytes);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2400);
  });

  test("a transparent oversized image keeps its alpha channel as WebP", async () => {
    const { tid } = await setupTask(h);
    const big = await noisePng(2000, 2000, 4); // ~16 MB RGBA
    const res = await h.upload(tid, "logo.png", big);
    expect(res.status).toBe(201);
    expect(res.data.filename).toBe("logo.webp");
    expect(res.data.mime).toBe("image/webp");
    expect(res.data.bytes).toBeLessThanOrEqual(7 * MB);
    const meta = await sharp(await download(res.data.url)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
  });

  test("a small file with a side above 8000 px is scaled down", async () => {
    const { tid } = await setupTask(h);
    const wide = pngBytes(8200, 1000);
    expect(wide.byteLength).toBeLessThan(MB);
    const res = await h.upload(tid, "wide.png", wide);
    expect(res.status).toBe(201);
    expect(res.data.resized.from.width).toBe(8200);
    expect(res.data.resized.to.width).toBeLessThanOrEqual(4096);
    const meta = await sharp(await download(res.data.url)).metadata();
    expect(meta.width!).toBeLessThanOrEqual(4096);
    // Aspect ratio is preserved (8.2:1).
    expect(meta.width! / meta.height!).toBeCloseTo(8.2, 0);
  });

  test("an aspect ratio above 10:1 is refused with an explanation", async () => {
    const { tid } = await setupTask(h);
    const res = await h.upload(tid, "banner.png", pngBytes(3000, 200));
    expect(res.status).toBe(400);
    expect(res.data.error).toContain("10×");
    expect((await h.api("GET", `/api/tasks/${tid}`)).data.refs).toHaveLength(0);
  });

  test("an oversized file that is not a decodable image is refused and leaves nothing behind", async () => {
    const { tid } = await setupTask(h);
    const junk = new Uint8Array(8 * MB);
    junk.set(pngBytes(8, 8).subarray(0, 40)); // valid-looking header, no pixel data
    const res = await h.upload(tid, "junk.png", junk);
    expect(res.status).toBe(400);
    expect(res.data.error).toContain("could not be decoded");
    expect((await h.api("GET", `/api/tasks/${tid}`)).data.refs).toHaveLength(0);
  });

  test("the model request carries the fitted image, below the 10 MB base64 limit", async () => {
    const { tid } = await setupTask(h);
    const res = await h.upload(tid, "big.png", await noisePng(2400, 2400, 3));
    expect(res.status).toBe(201);
    const { refDataUri } = await import("../src/server/ref-store.ts");
    const uri = refDataUri(h.app.ctx, res.data);
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(uri.length).toBeLessThan(10 * MB);
  });

  // Keep this test last: Bun's in-process fetch client stalls on later requests after the server
  // answers a 51 MB upload early without reading it (a separate process is unaffected).
  test("a file above the upload cap is refused with 413", async () => {
    const { tid } = await setupTask(h);
    const huge = new Uint8Array(51 * MB);
    huge.set(pngBytes(8, 8));
    expect((await h.upload(tid, "huge.png", huge)).status).toBe(413);
  });
});
