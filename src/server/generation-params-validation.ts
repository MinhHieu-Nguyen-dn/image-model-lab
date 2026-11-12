/**
 * Validation of generation parameters against documented Qwen Image limits:
 * seed 0..2147483647, n 1..6, size "w*h" with area 512²..2048² and ratio 1:8..8:1.
 * Throws HttpError(400) with a clear message on invalid input.
 */
import { HttpError } from "./http-utils.ts";

export const MAX_SEED = 2147483647;
export const MIN_N = 1;
export const MAX_N = 6;
export const MAX_MODELS_PER_RUN = 4;
const MIN_AREA = 512 * 512;
const MAX_AREA = 2048 * 2048;

/** Sizes above this many pixels (1536²) are billed and labelled as 2K; at or below it, 1K. Provider docs give no exact cut-off. */
export const HIGH_RES_AREA = 1536 * 1536;

export function isHighRes(size: string): boolean {
  const parsed = parseSize(size);
  return !!parsed && parsed.width * parsed.height > HIGH_RES_AREA;
}

export function parseSize(size: string): { width: number; height: number } | null {
  const m = /^(\d{2,5})\*(\d{2,5})$/.exec(size);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function validateSize(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "'size' must be a string like 1024*1024");
  const parsed = parseSize(value.trim());
  if (!parsed) throw new HttpError(400, "'size' must look like <width>*<height>, e.g. 1024*1024");
  const { width, height } = parsed;
  const area = width * height;
  if (area < MIN_AREA || area > MAX_AREA) {
    throw new HttpError(400, `'size' area ${width}x${height} must be between 512*512 and 2048*2048 pixels`);
  }
  const ratio = width / height;
  if (ratio < 1 / 8 || ratio > 8) throw new HttpError(400, "'size' aspect ratio must be between 1:8 and 8:1");
  return `${width}*${height}`;
}

export function validateN(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_N || value > MAX_N) {
    throw new HttpError(400, `'n' must be an integer ${MIN_N}..${MAX_N}`);
  }
  return value;
}

export function validateSeed(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_SEED) {
    throw new HttpError(400, `'seed' must be null or an integer 0..${MAX_SEED}`);
  }
  return value;
}

/** Model selection: unique keys that exist in the catalog, at most 4. */
export function validateModelKeys(value: unknown, knownKeys: string[], allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || value.some((k) => typeof k !== "string")) {
    throw new HttpError(400, "'models' must be an array of model keys");
  }
  const keys = [...new Set(value as string[])];
  const unknown = keys.filter((k) => !knownKeys.includes(k));
  if (unknown.length) throw new HttpError(400, `Unknown model key(s): ${unknown.join(", ")}`);
  if (!allowEmpty && keys.length === 0) throw new HttpError(400, "Select at least one model");
  if (keys.length > MAX_MODELS_PER_RUN) throw new HttpError(400, `Select at most ${MAX_MODELS_PER_RUN} models`);
  return keys;
}
