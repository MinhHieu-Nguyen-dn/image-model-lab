/**
 * Runs and per-model results persistence. Each ModelResult is its own row so
 * parallel model completions write independently; GET assembles the Run JSON.
 */
import type { AppContext } from "./app-context.ts";
import { nowIso } from "./db.ts";
import { HttpError } from "./http-utils.ts";
import { ratingsForRun } from "./image-rating-store.ts";
import type { RefJson } from "./ref-store.ts";
import type { UpstreamBody } from "./upstream-payload-builder.ts";

export type ResultStatus = "pending" | "running" | "ok" | "error" | "skipped";

export interface ResultImage {
  url: string;
  width: number;
  height: number;
  bytes: number;
  /** Merged in from the ratings table when a run is read; never stored in the result JSON. */
  rating?: "like" | "dislike";
}

export interface ModelResult {
  modelKey: string;
  label: string;
  apiModel: string;
  status: ResultStatus;
  error?: string;
  httpStatus?: number;
  latencyMs?: number;
  downloadMs?: number;
  requestId?: string;
  images: ResultImage[];
  imageCount?: number;
  seed?: number;
  rewriteStatus?: unknown;
  rewrittenPrompt?: string;
  usage?: unknown;
  estCost?: number;
  omittedParams: string[];
  payload: UpstreamBody | null;
}

export interface RunInputs {
  prompt: string;
  compiledText: string;
  negativePrompt: string;
  size: string;
  n: number;
  seed: number | null;
  promptExtend: boolean;
  refs: RefJson[];
}

export interface RunJson {
  id: string;
  taskId: string;
  createdAt: string;
  status: "running" | "done";
  inputs: RunInputs;
  results: ModelResult[];
}

interface RunRow { id: string; task_id: string; created_at: string; status: "running" | "done"; inputs: string }

export function insertRun(ctx: AppContext, id: string, taskId: string, inputs: RunInputs, results: ModelResult[], status: RunJson["status"]): void {
  const insertResult = ctx.db.query("INSERT INTO run_results (run_id, model_key, idx, data) VALUES (?, ?, ?, ?)");
  ctx.db.transaction(() => {
    ctx.db.query("INSERT INTO runs (id, task_id, created_at, status, inputs) VALUES (?, ?, ?, ?, ?)").run(id, taskId, nowIso(), status, JSON.stringify(inputs));
    results.forEach((r, i) => insertResult.run(id, r.modelKey, i, JSON.stringify(r)));
  })();
}

/** Silently ignores runs deleted meanwhile (task deleted during a run). */
export function saveResult(ctx: AppContext, runId: string, result: ModelResult): void {
  // Ratings live in image_ratings; a rating merged in by assemble() must never be persisted here.
  const stored = { ...result, images: result.images.map(({ rating: _rating, ...image }) => image) };
  ctx.db.query("UPDATE run_results SET data = ? WHERE run_id = ? AND model_key = ?").run(JSON.stringify(stored), runId, result.modelKey);
}

/** False once the run (or its task/project) was deleted; runners use it to stop writing files. */
export function runExists(ctx: AppContext, runId: string): boolean {
  return !!ctx.db.query("SELECT 1 FROM runs WHERE id = ?").get(runId);
}

export function markRunDone(ctx: AppContext, runId: string): void {
  ctx.db.query("UPDATE runs SET status = 'done' WHERE id = ?").run(runId);
}

function assemble(ctx: AppContext, row: RunRow): RunJson {
  const results = ctx.db
    .query<{ data: string }, [string]>("SELECT data FROM run_results WHERE run_id = ? ORDER BY idx ASC")
    .all(row.id)
    .map((r) => JSON.parse(r.data) as ModelResult);
  const ratings = ratingsForRun(ctx, row.id);
  for (const result of results) {
    result.images.forEach((image, i) => {
      const rating = ratings.get(`${result.modelKey}#${i}`);
      if (rating) image.rating = rating;
    });
  }
  return { id: row.id, taskId: row.task_id, createdAt: row.created_at, status: row.status, inputs: JSON.parse(row.inputs) as RunInputs, results };
}

export function getRun(ctx: AppContext, runId: string): RunJson {
  const row = ctx.db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!row) throw new HttpError(404, "Run not found");
  return assemble(ctx, row);
}

export function listRuns(ctx: AppContext, taskId: string): RunJson[] {
  return ctx.db
    .query<RunRow, [string]>("SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(taskId)
    .map((row) => assemble(ctx, row));
}

/**
 * On startup, runs left "running" by a previous process can never finish:
 * mark unfinished model results as errors and close the run.
 */
export function recoverInterruptedRuns(ctx: AppContext): void {
  const rows = ctx.db.query<RunRow, []>("SELECT * FROM runs WHERE status = 'running'").all();
  for (const row of rows) {
    for (const result of assemble(ctx, row).results) {
      if (result.status === "pending" || result.status === "running") {
        saveResult(ctx, row.id, { ...result, status: "error", error: "Interrupted: the server stopped before this model finished" });
      }
    }
    markRunDone(ctx, row.id);
  }
}
