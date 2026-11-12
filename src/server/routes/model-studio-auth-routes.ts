/**
 * Credential endpoints (global + per-project override) and the no-cost probe.
 * Responses only ever contain masked keys (`apiKeyMasked`, `hasKey`).
 */
import type { AppContext } from "../app-context.ts";
import { getCatalog } from "../catalog-store.ts";
import { normaliseEndpoint } from "../endpoint-normalisation.ts";
import { HttpError, json, readJsonObject } from "../http-utils.ts";
import { probeEndpoint, type TestResult } from "../model-client.ts";
import {
  deleteProjectAuth, loadAuth, maskEffective, maskEntry, resolveEffective, reusableKey, saveAuth, type StoredAuth,
} from "../model-studio-auth-store.ts";

const CHANGED_HOST_MESSAGE =
  "The endpoint host differs from the one the stored API key belongs to. Enter the API key again; a stored key is never sent to a different host.";
import { getProject } from "../project-task-store.ts";
import type { Router } from "../router.ts";

/** Optional key from a request body; "" or absent means "keep stored". */
function optionalKey(body: Record<string, unknown>): string | undefined {
  const key = body.apiKey;
  if (key === undefined || key === null || key === "") return undefined;
  if (typeof key !== "string") throw new HttpError(400, "'apiKey' must be a string");
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 512 || /\s/.test(trimmed)) throw new HttpError(400, "'apiKey' must be a non-empty token without whitespace");
  return trimmed;
}

function requireEndpoint(body: Record<string, unknown>): string {
  if (typeof body.endpoint !== "string") throw new HttpError(400, "'endpoint' must be a string");
  return normaliseEndpoint(body.endpoint);
}

function probeModel(ctx: AppContext): string {
  return getCatalog(ctx.db).models[0]?.apiModel ?? "qwen-image-3.0";
}

function view(ctx: AppContext, pid?: string) {
  const file = loadAuth(ctx.imagesDir);
  const base = { global: maskEntry(file.global), effective: maskEffective(resolveEffective(file, pid)) };
  return pid ? { ...base, project: maskEntry(file.projects[pid]) } : base;
}

async function testStored(ctx: AppContext, entry: StoredAuth | null): Promise<TestResult> {
  if (!entry) return { ok: false, kind: "invalid_key", message: "No credentials configured", latencyMs: 0 };
  return probeEndpoint(entry.endpoint, entry.apiKey, probeModel(ctx));
}

export function registerAuthRoutes(router: Router): void {
  router
    .add("GET", "/api/credentials", (_req, _p, ctx) => json(view(ctx)))
    .add("PUT", "/api/credentials", async (req, _p, ctx) => {
      const body = await readJsonObject(req);
      const endpoint = requireEndpoint(body);
      const file = loadAuth(ctx.imagesDir);
      const apiKey = optionalKey(body) ?? reusableKey(endpoint, file.global);
      if (apiKey === undefined && file.global?.apiKey) throw new HttpError(400, CHANGED_HOST_MESSAGE);
      file.global = { endpoint, apiKey: apiKey ?? "" };
      saveAuth(ctx.imagesDir, file);
      const test = await testStored(ctx, file.global);
      return json({ saved: true, credentials: view(ctx), test });
    })
    .add("POST", "/api/credentials/test", async (req, _p, ctx) => {
      const body = await readJsonObject(req);
      const pid = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
      if (pid) getProject(ctx, pid);
      const file = loadAuth(ctx.imagesDir);
      const base = pid ? resolveEffective(file, pid) : file.global;
      const endpoint = body.endpoint !== undefined && body.endpoint !== "" ? requireEndpoint(body) : base?.endpoint;
      if (!endpoint) throw new HttpError(400, "No endpoint provided or stored");
      // The stored key is only ever sent to the endpoint it was stored with.
      const apiKey = optionalKey(body) ?? reusableKey(endpoint, base);
      if (apiKey === undefined && base?.apiKey) {
        return json({ ok: false, kind: "invalid_key", message: CHANGED_HOST_MESSAGE, latencyMs: 0 } satisfies TestResult);
      }
      return json(await probeEndpoint(endpoint, apiKey ?? "", probeModel(ctx)));
    })
    .add("GET", "/api/projects/:pid/credentials", (_req, p, ctx) => {
      getProject(ctx, p.pid);
      return json(view(ctx, p.pid));
    })
    .add("PUT", "/api/projects/:pid/credentials", async (req, p, ctx) => {
      getProject(ctx, p.pid);
      const body = await readJsonObject(req);
      const endpoint = requireEndpoint(body);
      const file = loadAuth(ctx.imagesDir);
      // A global key on the same host is borrowed at request time (empty stored key), never copied,
      // so rotating the global key keeps this project working.
      const apiKey = optionalKey(body) ?? reusableKey(endpoint, file.projects[p.pid]);
      const borrowsGlobal = apiKey === undefined && reusableKey(endpoint, file.global) !== undefined;
      if (apiKey === undefined && !borrowsGlobal && (file.projects[p.pid]?.apiKey || file.global?.apiKey)) {
        throw new HttpError(400, CHANGED_HOST_MESSAGE);
      }
      file.projects[p.pid] = { endpoint, apiKey: apiKey ?? "" };
      saveAuth(ctx.imagesDir, file);
      const test = await testStored(ctx, resolveEffective(file, p.pid));
      return json({ saved: true, credentials: view(ctx, p.pid), test });
    })
    .add("DELETE", "/api/projects/:pid/credentials", (_req, p, ctx) => {
      getProject(ctx, p.pid);
      deleteProjectAuth(ctx.imagesDir, p.pid);
      return json(view(ctx, p.pid));
    });
}
