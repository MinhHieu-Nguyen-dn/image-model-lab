/**
 * Test harness: starts the mock Model Studio and the studio app in-process on
 * ephemeral ports with a temp IMAGES_DIR (never the real ./images), and records
 * every API response body so tests can assert the API key never leaks.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { join } from "node:path";
import { startApp, type RunningApp } from "../../src/server/app.ts";
import { startMockModelStudio, solidPng, MOCK_GOOD_KEY } from "../../scripts/mock-model-studio.ts";
import type { RunJson } from "../../src/server/run-store.ts";

export { MOCK_GOOD_KEY, solidPng };

export type Mock = ReturnType<typeof startMockModelStudio>;

export interface Harness {
  mock: Mock;
  app: RunningApp;
  imagesDir: string;
  publicDir: string;
  /** Every response body text received through `api`. */
  responses: string[];
  // `any` default is deliberate: tests assert on loosely-typed JSON responses field by field.
  api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }>;
  upload(tid: string, filename: string, bytes: Uint8Array): Promise<{ status: number; data: any }>;
  waitForRun(rid: string, timeoutMs?: number): Promise<RunJson>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export const FAST_LATENCIES = {
  "qwen-image-3.0": 30, "qwen-image-3.0-pro": 60, "qwen-image-2.1-pro": 90, "qwen-image-2.1-turbo": 300,
};

export async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "qwen-studio-test-"));
  const imagesDir = join(root, "images");
  const publicDir = join(root, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>studio</title>");
  const mock = startMockModelStudio({ port: 0, defaultLatencyMs: 20, latencies: FAST_LATENCIES });
  const responses: string[] = [];

  const h: Harness = {
    mock,
    app: startApp({ port: 0, imagesDir, publicDir }),
    imagesDir,
    publicDir,
    responses,
    async api(method, path, body) {
      const res = await fetch(h.app.url + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      responses.push(text);
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    async upload(tid, filename, bytes) {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(bytes)], filename));
      const res = await fetch(`${h.app.url}/api/tasks/${tid}/refs`, { method: "POST", body: form });
      const text = await res.text();
      responses.push(text);
      return { status: res.status, data: JSON.parse(text) };
    },
    async waitForRun(rid, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { data } = await h.api<RunJson>("GET", `/api/runs/${rid}`);
        if (data.status === "done") return data;
        await Bun.sleep(25);
      }
      throw new Error(`Run ${rid} did not finish within ${timeoutMs}ms`);
    },
    async restart() {
      await h.app.stop();
      h.app = startApp({ port: 0, imagesDir, publicDir });
    },
    async close() {
      await h.app.stop();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return h;
}

/** Creates a project + task and stores global credentials pointing at the mock. */
export async function setupTask(h: Harness, apiKey = MOCK_GOOD_KEY): Promise<{ pid: string; tid: string }> {
  const project = await h.api("POST", "/api/projects", { name: "P" });
  const task = await h.api("POST", `/api/projects/${project.data.id}/tasks`, { name: "T" });
  await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey });
  return { pid: project.data.id, tid: task.data.id };
}

export const pngBytes = (w = 64, h = 64, rgb: [number, number, number] = [200, 10, 10]) => new Uint8Array(solidPng(w, h, rgb));

/** Incompressible PNG (random pixels) so its file size is close to width*height*channels bytes. */
export async function noisePng(width: number, height: number, channels: 3 | 4): Promise<Uint8Array> {
  const raw = new Uint8Array(width * height * channels);
  for (let off = 0; off < raw.length; off += 65536) crypto.getRandomValues(raw.subarray(off, Math.min(off + 65536, raw.length)));
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 1 }).toBuffer());
}
