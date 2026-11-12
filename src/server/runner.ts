/**
 * Run executor. `startRun` snapshots task inputs, persists a "running" run and
 * returns immediately; the selected models then execute in parallel
 * (Promise.allSettled) and each result row is updated as its model finishes.
 * Over-limit models are "skipped" up front and never call the API.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "./app-context.ts";
import type { CatalogModel } from "./catalog-store.ts";
import { newId } from "./db.ts";
import { HttpError, isRecord } from "./http-utils.ts";
import { isHighRes } from "./generation-params-validation.ts";
import { extForFormat, readImageInfo } from "./image-meta.ts";
import { callGeneration, downloadImage } from "./model-client.ts";
import { loadAuth, resolveEffective, type EffectiveAuth } from "./model-studio-auth-store.ts";
import { fileUrl, runDir } from "./paths.ts";
import { refDataUri } from "./ref-store.ts";
import { getRun, insertRun, markRunDone, runExists, saveResult, type ModelResult, type ResultImage, type RunJson } from "./run-store.ts";
import { compileTask } from "./task-compile-service.ts";
import { buildBody } from "./upstream-payload-builder.ts";
import type { RunInputs } from "./run-store.ts";

interface RunJob {
  ctx: AppContext;
  runId: string;
  dir: string;
  auth: EffectiveAuth;
  inputs: RunInputs;
  images: string[];
}

export function startRun(ctx: AppContext, tid: string, requestedModels?: unknown): RunJson {
  const compiled = compileTask(ctx, tid, requestedModels);
  const auth = resolveEffective(loadAuth(ctx.imagesDir), compiled.task.projectId);
  if (!auth || !auth.apiKey) throw new HttpError(400, "No API key configured; set credentials before running");

  // Read ref bytes now so a later ref delete cannot change this run's inputs.
  const images = compiled.inputs.refs.map((ref) => refDataUri(ctx, ref));
  const runId = newId("run");
  const results: ModelResult[] = compiled.models.map((m) => {
    const plan = compiled.plans.get(m.key)!;
    return {
      modelKey: m.key, label: m.label, apiModel: m.apiModel, status: plan.ok ? "pending" : "skipped",
      ...(plan.error ? { error: plan.error } : {}), images: [], omittedParams: plan.omittedParams, payload: plan.payload,
    };
  });
  const runnable = compiled.models.filter((m) => compiled.plans.get(m.key)!.ok);
  insertRun(ctx, runId, tid, compiled.inputs, results, runnable.length ? "running" : "done");

  if (runnable.length) {
    const job: RunJob = { ctx, runId, dir: runDir(ctx.imagesDir, compiled.task.projectId, tid, runId), auth, inputs: compiled.inputs, images };
    const byKey = new Map(results.map((r) => [r.modelKey, r]));
    const done = Promise.allSettled(runnable.map((m) => executeModel(job, m, byKey.get(m.key)!)))
      .then(() => markRunDone(ctx, runId))
      .catch((err) => console.error(`run ${runId}: failed to finalise: ${(err as Error).message}`))
      .finally(() => ctx.pendingRuns.delete(done));
    ctx.pendingRuns.add(done);
  }
  return getRun(ctx, runId);
}

/** Extracts image URLs from `output.choices[].message.content[].image`. */
function extractImageUrls(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.choices)) return [];
  const urls: string[] = [];
  for (const choice of output.choices) {
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const item of content) if (isRecord(item) && typeof item.image === "string") urls.push(item.image);
  }
  return urls;
}

/** Optional response metadata; field names vary by model so several are checked. */
function extractMeta(data: Record<string, unknown>) {
  const output = isRecord(data.output) ? data.output : {};
  const usage = isRecord(data.usage) ? data.usage : undefined;
  const pick = (...vals: unknown[]) => vals.find((v) => v !== undefined && v !== null);
  const seed = pick(output.seed, usage?.seed);
  const rewritten = pick(output.actual_prompt, output.rewritten_prompt, output.rewrite_prompt);
  return {
    usage: data.usage,
    seed: typeof seed === "number" ? seed : undefined,
    rewrittenPrompt: typeof rewritten === "string" ? rewritten : undefined,
    rewriteStatus: pick(output.rewrite_status, output.prompt_rewrite_status) as unknown,
    imageCount: typeof usage?.image_count === "number" ? usage.image_count : undefined,
  };
}

async function saveImage(job: RunJob, model: CatalogModel, url: string, i: number): Promise<ResultImage> {
  const bytes = await downloadImage(url);
  const info = readImageInfo(bytes);
  if (!info) throw new Error(`Downloaded file #${i + 1} is not a recognised image`);
  // The task/project may have been deleted while the model was generating; do not recreate its folder.
  // Check and write synchronously (no await in between) so a delete cannot slip in after the check.
  if (!runExists(job.ctx, job.runId)) throw new Error("Run was deleted; result discarded");
  const abs = join(job.dir, `${model.key}-${i}.${extForFormat(info.format)}`);
  mkdirSync(job.dir, { recursive: true });
  writeFileSync(abs, bytes);
  return { url: fileUrl(job.ctx.imagesDir, abs), width: info.width, height: info.height, bytes: bytes.byteLength };
}

/** 2K output uses the model's 2K price when it has one. */
function priceFor(model: CatalogModel, size: string): number {
  return isHighRes(size) && model.pricePerImage2k !== undefined ? model.pricePerImage2k : model.pricePerImage;
}

async function executeModel(job: RunJob, model: CatalogModel, initial: ModelResult): Promise<void> {
  const { ctx, runId } = job;
  let result: ModelResult = { ...initial, status: "running" };
  saveResult(ctx, runId, result);
  try {
    const { body } = buildBody(model, job.inputs, job.images);
    const outcome = await callGeneration(job.auth.endpoint, job.auth.apiKey, body);
    result = { ...result, latencyMs: outcome.latencyMs, httpStatus: outcome.httpStatus, requestId: outcome.requestId };
    if (!outcome.ok || !outcome.data) {
      result = { ...result, status: "error", error: outcome.error ?? "Request failed" };
      return;
    }
    const meta = extractMeta(outcome.data);
    result = { ...result, usage: meta.usage, seed: meta.seed ?? job.inputs.seed ?? undefined, rewrittenPrompt: meta.rewrittenPrompt, rewriteStatus: meta.rewriteStatus };
    const urls = extractImageUrls(outcome.data.output);
    if (!urls.length) {
      result = { ...result, status: "error", error: "Response contained no images" };
      return;
    }
    const dlStart = performance.now();
    const saved = await Promise.allSettled(urls.map((u, i) => saveImage(job, model, u, i)));
    const images = saved.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const failures = saved.flatMap((s, i) => (s.status === "rejected" ? [`image ${i + 1}: ${(s.reason as Error).message}`] : []));
    // The generation succeeded upstream, so it was billed even if some downloads failed.
    const imageCount = meta.imageCount ?? urls.length;
    result = {
      ...result, images, imageCount, downloadMs: Math.round(performance.now() - dlStart),
      estCost: Math.round(priceFor(model, job.inputs.size) * imageCount * 1e6) / 1e6,
      ...(images.length
        ? { status: "ok", ...(failures.length ? { error: `${failures.length} of ${urls.length} image(s) could not be downloaded (${failures.join("; ")})` } : {}) }
        : { status: "error", error: `Generated but could not download any image (${failures.join("; ")})` }),
    };
  } catch (err) {
    result = { ...result, status: "error", error: `Failed to process result: ${(err as Error).message}` };
  } finally {
    saveResult(ctx, runId, result);
  }
}
