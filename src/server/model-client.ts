/**
 * HTTP client for the Model Studio (DashScope) sync generation endpoint:
 * generation call with server-side latency, a no-cost probe, and result image download.
 * The API key is only placed in the Authorization header; it is never logged or echoed.
 */
import type { UpstreamBody } from "./upstream-payload-builder.ts";

export const GENERATION_TIMEOUT_MS = 300_000;
export const PROBE_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface GenerationOutcome {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  requestId?: string;
  error?: string;
  /** Parsed JSON response (success or error body), when any. */
  data?: Record<string, unknown>;
}

export type TestKind = "ok" | "invalid_key" | "wrong_path" | "unreachable" | "unexpected";

export interface TestResult {
  ok: boolean;
  kind: TestKind;
  httpStatus?: number;
  message: string;
  latencyMs: number;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "Request timed out" : err.message;
  return String(err);
}

async function readJsonSafe(res: Response): Promise<Record<string, unknown> | undefined> {
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Latency = wall time of the HTTP call including reading the response body. */
export async function callGeneration(endpoint: string, apiKey: string, body: UpstreamBody): Promise<GenerationOutcome> {
  const start = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    const data = await readJsonSafe(res);
    const latencyMs = Math.round(performance.now() - start);
    const requestId = typeof data?.request_id === "string" ? data.request_id : undefined;
    if (!res.ok) {
      const code = typeof data?.code === "string" ? data.code : `HTTP ${res.status}`;
      const message = typeof data?.message === "string" ? data.message : res.statusText || "Request failed";
      return { ok: false, httpStatus: res.status, latencyMs, requestId, error: `${code}: ${message}`, data };
    }
    if (!data) return { ok: false, httpStatus: res.status, latencyMs, requestId, error: "Upstream returned a non-JSON response" };
    return { ok: true, httpStatus: res.status, latencyMs, requestId, data };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: `Network error: ${errMessage(err)}` };
  }
}

/**
 * No-cost credential probe: sends a deliberately incomplete body (no input messages)
 * so a valid key yields 400 and no image is generated.
 */
export async function probeEndpoint(endpoint: string, apiKey: string, apiModel: string): Promise<TestResult> {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  if (!apiKey) return { ok: false, kind: "invalid_key", message: "No API key configured", latencyMs: 0 };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: apiModel, input: {} }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, kind: "unreachable", message: `Endpoint unreachable: ${errMessage(err)}`, latencyMs: elapsed() };
  }
  const data = await readJsonSafe(res).catch(() => undefined);
  const latencyMs = elapsed();
  const upstream = typeof data?.message === "string" ? ` (${String(data?.code ?? "")}: ${data.message})` : "";
  const httpStatus = res.status;
  if (httpStatus === 401 || httpStatus === 403) {
    return { ok: false, kind: "invalid_key", httpStatus, message: `API key rejected${upstream}`, latencyMs };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return { ok: true, kind: "ok", httpStatus, message: "Endpoint reachable and API key accepted", latencyMs };
  }
  if (httpStatus === 429) {
    // Throttling is applied after authentication, so host, path and key are accepted.
    return { ok: true, kind: "ok", httpStatus, latencyMs, message: `Endpoint reachable and API key accepted, but the workspace is rate-limited right now${upstream}` };
  }
  if (httpStatus === 404 && /model/i.test(String(data?.message ?? ""))) {
    // Authentication runs before model lookup, so the host, path and key are fine; only the model id is unknown.
    return {
      ok: true, kind: "ok", httpStatus, latencyMs,
      message: `Endpoint reachable and API key accepted, but model '${apiModel}' was not found in this workspace${upstream}. Check its API model ID in the catalog.`,
    };
  }
  if (httpStatus === 404) {
    return { ok: false, kind: "wrong_path", httpStatus, message: `Endpoint path not found (404); check the URL${upstream}`, latencyMs };
  }
  return { ok: false, kind: "unexpected", httpStatus, message: `Unexpected HTTP ${httpStatus}${upstream}`, latencyMs };
}

/** Downloads a result image (URLs expire after 24h, so this runs immediately). */
export async function downloadImage(url: string): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid image URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Image URL must be http(s)");
  const res = await fetch(parsed, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Image download failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("Image download exceeds 50MB");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  // Stream so an oversized or endless body is cut off at the cap instead of filling memory.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Image download exceeds 50MB");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf;
}
