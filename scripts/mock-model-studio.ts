/**
 * Mock Alibaba Cloud Model Studio (DashScope) sync image endpoint for local/browser testing.
 *
 * Start:   bun run mock                       (http://127.0.0.1:4199)
 *          MOCK_PORT=4300 bun run mock        (other port)
 * Then set the studio credentials to:
 *          endpoint = http://127.0.0.1:4199   (generation path is appended automatically)
 *          apiKey   = good-key                (any other key -> 401 InvalidApiKey)
 *
 * Behaviour on POST /api/v1/services/aigc/multimodal-generation/generation:
 *  - wrong/missing Bearer key            -> 401 {code:"InvalidApiKey"}
 *  - incomplete/invalid body             -> 400 {code:"InvalidParameter"}  (this is what the studio's probe sends)
 *  - model id containing "fail"          -> 400 {code:"InvalidModel"}
 *  - model id containing "noimg"/"partial" -> 200, but image downloads 404 (all / the 2nd one); for testing
 *  - otherwise, after a per-model latency -> 200 with n PNG URLs (solid colour per model, honours parameters.size),
 *    usage {width,height,image_count} and request_id. Images are served by this mock at /images/...
 * Other paths -> 404. Latency env: MOCK_LATENCY_MS (default for unknown models, 400) and
 * MOCK_LATENCIES="qwen-image-3.0=800,qwen-image-2.1-turbo=1500" (per-model overrides).
 * Debug: GET /__mock/requests lists received generation requests; DELETE clears them.
 */
import { deflateSync } from "node:zlib";

export const MOCK_GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
export const MOCK_GOOD_KEY = "good-key";

const DEFAULT_LATENCIES: Record<string, number> = {
  "qwen-image-3.0": 600, "qwen-image-3.0-pro": 900, "qwen-image-2.1-pro": 1200, "qwen-image-2.1-turbo": 1500,
};

export interface MockRequestRecord {
  path: string;
  status: number;
  model?: string;
  imageCount: number;
  text?: string;
  /** Kinds of content items in order, e.g. ["image","image","text"]. */
  contentKinds: string[];
  parameters?: Record<string, unknown>;
}

export interface MockOptions {
  port?: number;
  defaultLatencyMs?: number;
  latencies?: Record<string, number>;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes a solid-colour RGB PNG of the given size. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", new Uint8Array())]);
}

/** Deterministic colour per model id (+ image index) so each model's images look distinct. */
function colourFor(model: string, i: number): [number, number, number] {
  let h = 2166136261;
  for (const ch of model) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return [(h >>> 16) & 0xff, (h >>> 8) & 0xff, (h + i * 40) & 0xff];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const errorJson = (status: number, code: string, message: string) =>
  Response.json({ code, message, request_id: crypto.randomUUID() }, { status });

/** Returns an error message when the body is not a complete generation request. */
function validateBody(body: unknown): string | null {
  if (!isRecord(body) || typeof body.model !== "string" || !body.model) return "Field 'model' is required";
  const messages = isRecord(body.input) ? body.input.messages : undefined;
  if (!Array.isArray(messages) || messages.length === 0) return "Field 'input.messages' is required";
  const content = isRecord(messages[0]) ? messages[0].content : undefined;
  if (!Array.isArray(content) || content.length === 0) return "Field 'input.messages[0].content' is required";
  const texts = content.filter((c) => isRecord(c) && typeof c.text === "string");
  if (texts.length !== 1) return "Exactly one text item is required in content";
  const last = content[content.length - 1];
  if (!isRecord(last) || typeof last.text !== "string") return "The text item must come after all image items";
  for (const c of content.slice(0, -1)) {
    if (!isRecord(c) || typeof c.image !== "string" || !/^(data:image\/|https?:)/.test(c.image)) return "Invalid image item";
  }
  const size = isRecord(body.parameters) ? body.parameters.size : undefined;
  if (size !== undefined && (typeof size !== "string" || !/^\d+\*\d+$/.test(size))) return "Invalid parameters.size";
  return null;
}

export function startMockModelStudio(opts: MockOptions = {}) {
  const requests: MockRequestRecord[] = [];
  // Per-model override > built-in default for the 4 known ids > default for unknown ids.
  const latencyFor = (model: string) => opts.latencies?.[model] ?? DEFAULT_LATENCIES[model] ?? opts.defaultLatencyMs ?? 400;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 4199,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const img = /^\/images\/([^/]+)\/(\d+)x(\d+)\/(\d+)\.png$/.exec(url.pathname);
      if (req.method === "GET" && img) {
        const [w, h] = [Number(img[2]), Number(img[3])];
        if (w < 1 || h < 1 || w > 4096 || h > 4096) return new Response("bad size", { status: 400 });
        const imgModel = decodeURIComponent(img[1]);
        // Test hooks: "noimg" models never serve their images; "partial" models fail the second image only.
        if (imgModel.includes("noimg") || (imgModel.includes("partial") && Number(img[4]) === 1)) return new Response("gone", { status: 404 });
        return new Response(new Uint8Array(solidPng(w, h, colourFor(decodeURIComponent(img[1]), Number(img[4])))), { headers: { "content-type": "image/png" } });
      }
      if (url.pathname === "/__mock/requests") {
        if (req.method === "DELETE") requests.length = 0;
        return Response.json(requests);
      }
      if (req.method !== "POST" || url.pathname !== MOCK_GENERATION_PATH) return errorJson(404, "NotFound", `No route for ${req.method} ${url.pathname}`);

      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        body = null;
      }
      const content = isRecord(body) && isRecord(body.input) && Array.isArray(body.input.messages) && isRecord(body.input.messages[0]) && Array.isArray(body.input.messages[0].content)
        ? (body.input.messages[0].content as unknown[]) : [];
      const record: MockRequestRecord = {
        path: url.pathname, status: 0,
        model: isRecord(body) && typeof body.model === "string" ? body.model : undefined,
        imageCount: content.filter((c) => isRecord(c) && typeof c.image === "string").length,
        text: content.map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : undefined)).find((t) => t !== undefined),
        contentKinds: content.map((c) => (isRecord(c) ? (typeof c.image === "string" ? "image" : typeof c.text === "string" ? "text" : "other") : "other")),
        parameters: isRecord(body) && isRecord(body.parameters) ? body.parameters : undefined,
      };
      requests.push(record);
      const finish = (res: Response) => ((record.status = res.status), res);

      if (req.headers.get("authorization") !== `Bearer ${MOCK_GOOD_KEY}`) {
        return finish(errorJson(401, "InvalidApiKey", "Invalid API-key provided."));
      }
      // A model id containing "ghost" is unknown to the workspace: real DashScope answers 404 "Model not exist." after auth.
      if (isRecord(body) && typeof body.model === "string" && body.model.includes("ghost")) {
        return finish(errorJson(404, "InvalidParameter", "Model not exist."));
      }
      if (isRecord(body) && typeof body.model === "string" && body.model.includes("ratelimit")) {
        return finish(errorJson(429, "Throttling.RateQuota", "Requests rate limit exceeded, please try again later."));
      }
      const invalid = validateBody(body);
      if (invalid) return finish(errorJson(400, "InvalidParameter", invalid));
      const b = body as { model: string; parameters?: Record<string, unknown> };
      if (b.model.includes("fail")) return finish(errorJson(400, "InvalidModel", `Model not exist: ${b.model}`));

      await Bun.sleep(latencyFor(b.model));
      const [w, h] = String(b.parameters?.size ?? "1024*1024").split("*").map(Number);
      const n = typeof b.parameters?.n === "number" ? b.parameters.n : 1;
      const base: string = `http://127.0.0.1:${server.port}/images/${encodeURIComponent(b.model)}/${w}x${h}`;
      return finish(Response.json({
        output: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: Array.from({ length: n }, (_, i) => ({ image: `${base}/${i}.png` })) } }] },
        usage: { width: w, height: h, image_count: n },
        request_id: crypto.randomUUID(),
      }));
    },
  });

  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    endpoint: `http://127.0.0.1:${server.port}${MOCK_GENERATION_PATH}`,
    requests,
    stop: () => server.stop(true),
  };
}

function parseLatencies(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (raw ?? "").split(",").filter(Boolean)) {
    const [model, ms] = pair.split("=");
    if (model && Number.isFinite(Number(ms))) out[model.trim()] = Number(ms);
  }
  return out;
}

if (import.meta.main) {
  const mock = startMockModelStudio({
    port: Number(process.env.MOCK_PORT ?? 4199),
    defaultLatencyMs: process.env.MOCK_LATENCY_MS ? Number(process.env.MOCK_LATENCY_MS) : undefined,
    latencies: parseLatencies(process.env.MOCK_LATENCIES),
  });
  console.log(`Mock Model Studio at ${mock.url} (key: ${MOCK_GOOD_KEY}; model id containing "fail" -> 400)`);
}
