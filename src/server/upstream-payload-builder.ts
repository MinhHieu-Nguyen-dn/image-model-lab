/**
 * Builds the exact DashScope sync request body for one model and decides
 * per-model eligibility (ref-count limit) and omitted params.
 *
 * Body: {model, input:{messages:[{role:"user", content:[{image}, ..., {text}]}]},
 *        parameters:{size, n, seed?, negative_prompt?, prompt_extend, watermark:false}}
 */
import type { CatalogModel } from "./catalog-store.ts";

export interface GenerationInputs {
  compiledText: string;
  negativePrompt: string;
  size: string;
  n: number;
  seed: number | null;
  promptExtend: boolean;
  refs: { id: string; order: number; filename: string; bytes: number }[];
}

export interface UpstreamBody {
  model: string;
  input: { messages: { role: "user"; content: ({ image: string } | { text: string })[] }[] };
  parameters: Record<string, unknown>;
}

export interface ModelPlan {
  ok: boolean;
  /** Set when the model must not be called (no upstream request is made). */
  error?: string;
  omittedParams: string[];
  /** Request body with images abbreviated as `<image #k: filename, bytes>`. */
  payload: UpstreamBody;
}

export function buildBody(model: CatalogModel, inputs: GenerationInputs, images: string[]): { body: UpstreamBody; omittedParams: string[] } {
  const omittedParams: string[] = [];
  const parameters: Record<string, unknown> = { size: inputs.size, n: inputs.n };
  if (inputs.seed !== null) parameters.seed = inputs.seed;
  const negative = inputs.negativePrompt.trim();
  if (negative) {
    if (model.supportsNegativePrompt) parameters.negative_prompt = negative;
    else omittedParams.push("negative_prompt");
  }
  parameters.prompt_extend = inputs.promptExtend;
  parameters.watermark = false;
  const content = [...images.map((image) => ({ image })), { text: inputs.compiledText }];
  return { body: { model: model.apiModel, input: { messages: [{ role: "user", content }] }, parameters }, omittedParams };
}

/** Human-readable stand-ins for image data in stored/previewed payloads. */
export function abbreviatedImages(inputs: GenerationInputs): string[] {
  return inputs.refs.map((r) => `<image #${r.order}: ${r.filename}, ${r.bytes} bytes>`);
}

export function planModel(model: CatalogModel, inputs: GenerationInputs): ModelPlan {
  const { body, omittedParams } = buildBody(model, inputs, abbreviatedImages(inputs));
  if (inputs.refs.length > model.maxRefImages) {
    return {
      ok: false,
      error: `${model.label} accepts at most ${model.maxRefImages} reference image(s) but ${inputs.refs.length} were provided; not sent to the API.`,
      omittedParams,
      payload: body,
    };
  }
  return { ok: true, omittedParams, payload: body };
}
