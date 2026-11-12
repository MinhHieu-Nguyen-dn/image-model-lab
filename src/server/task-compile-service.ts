/**
 * Turns a task (+ optional model selection) into a validated generation snapshot:
 * compiled prompt text, ref order and the per-model plan (eligibility, omitted
 * params, abbreviated payload). Shared by the compile preview and the runner.
 */
import type { AppContext } from "./app-context.ts";
import { getCatalog, type CatalogModel } from "./catalog-store.ts";
import { HttpError } from "./http-utils.ts";
import { compilePrompt } from "./prompt-compiler.ts";
import { getTask } from "./project-task-store.ts";
import { planModel, type GenerationInputs, type ModelPlan, type UpstreamBody } from "./upstream-payload-builder.ts";
import { validateModelKeys, validateN, validateSeed, validateSize } from "./generation-params-validation.ts";
import type { RunInputs } from "./run-store.ts";
import type { TaskJson } from "./project-task-store.ts";

export interface CompiledTask {
  task: TaskJson;
  text: string;
  refOrder: string[];
  inputs: RunInputs;
  models: CatalogModel[];
  plans: Map<string, ModelPlan>;
}

export interface CompileResponse {
  text: string;
  refOrder: string[];
  perModel: Record<string, { apiModel: string; ok: boolean; error?: string; omittedParams: string[]; payload: UpstreamBody }>;
}

export function compileTask(ctx: AppContext, tid: string, requestedModels?: unknown): CompiledTask {
  const task = getTask(ctx, tid);
  const catalog = getCatalog(ctx.db);
  const keys = validateModelKeys(requestedModels ?? task.models, catalog.models.map((m) => m.key), false);
  const models = keys.map((k) => catalog.models.find((m) => m.key === k)!);

  // Re-validate stored params so a stale row can never produce an invalid request.
  const size = validateSize(task.size);
  const n = validateN(task.n);
  const seed = validateSeed(task.seed);
  const { text, refOrder } = compilePrompt(task.prompt, task.refs.map((r) => r.id), catalog.refTemplate);
  if (!text.trim()) throw new HttpError(400, "Prompt is empty");

  const inputs: RunInputs = {
    prompt: task.prompt, compiledText: text, negativePrompt: task.negativePrompt,
    size, n, seed, promptExtend: task.promptExtend, refs: task.refs,
  };
  const genInputs: GenerationInputs = { ...inputs };
  const plans = new Map(models.map((m) => [m.key, planModel(m, genInputs)]));
  return { task, text, refOrder, inputs, models, plans };
}

export function toCompileResponse(compiled: CompiledTask): CompileResponse {
  const perModel: CompileResponse["perModel"] = {};
  for (const m of compiled.models) {
    const plan = compiled.plans.get(m.key)!;
    perModel[m.key] = { apiModel: m.apiModel, ok: plan.ok, ...(plan.error ? { error: plan.error } : {}), omittedParams: plan.omittedParams, payload: plan.payload };
  }
  return { text: compiled.text, refOrder: compiled.refOrder, perModel };
}
