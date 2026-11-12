/**
 * Compiles a stored prompt containing chip tokens `{{ref:<refId>}}` into plain text.
 * Each chip becomes the ref template (default `image {n}`) with {n} = the ref's
 * current 1-based position, so reordering refs renumbers the compiled text.
 */
import { HttpError } from "./http-utils.ts";

/** Must stay identical to REF_TOKEN_RE in public/modules/prompt-chip-serialization.js. */
export const CHIP_RE = /\{\{ref:([A-Za-z0-9_-]+)\}\}/g;

export interface CompiledPrompt {
  text: string;
  /** Ref ids in current order (== order of {image} items in the request). */
  refOrder: string[];
}

export function compilePrompt(prompt: string, orderedRefIds: string[], template: string): CompiledPrompt {
  const position = new Map(orderedRefIds.map((id, i) => [id, i + 1]));
  const missing = new Set<string>();
  const text = prompt.replace(CHIP_RE, (_match, refId: string) => {
    const n = position.get(refId);
    if (n === undefined) {
      missing.add(refId);
      return "";
    }
    return template.split("{n}").join(String(n));
  });
  if (missing.size) {
    throw new HttpError(400, `Prompt references deleted reference image(s): ${[...missing].join(", ")}. Remove the chip(s) and try again.`);
  }
  return { text, refOrder: [...orderedRefIds] };
}
