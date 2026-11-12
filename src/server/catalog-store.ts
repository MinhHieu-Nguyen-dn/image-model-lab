/**
 * Model catalog + ref template, persisted in the `settings` table under key `catalog`.
 * Defaults: the four Qwen Image models with apiModel == key, template `image {n}`, and the Singapore
 * (International) 1k output price per image in USD from the Model Studio pricing page (docs checked 2026-11;
 * 3.0-pro is $0.075 at 2k, and input images are billed extra on the 3.0 series, neither is modelled here).
 */
import type { Database } from "bun:sqlite";
import { HttpError, isRecord } from "./http-utils.ts";

export interface CatalogModel {
  key: string;
  label: string;
  apiModel: string;
  pricePerImage: number;
  /** Price per image for 2K output (area above `HIGH_RES_AREA`); falls back to `pricePerImage` when absent. */
  pricePerImage2k?: number;
  maxRefImages: number;
  supportsNegativePrompt: boolean;
}

export interface Catalog {
  models: CatalogModel[];
  refTemplate: string;
}

export const DEFAULT_CATALOG: Catalog = {
  models: [
    { key: "qwen-image-3.0", label: "Qwen Image 3.0", apiModel: "qwen-image-3.0", pricePerImage: 0.03, maxRefImages: 3, supportsNegativePrompt: true },
    { key: "qwen-image-3.0-pro", label: "Qwen Image 3.0 Pro", apiModel: "qwen-image-3.0-pro", pricePerImage: 0.04, pricePerImage2k: 0.075, maxRefImages: 3, supportsNegativePrompt: true },
    { key: "qwen-image-2.1-pro", label: "Qwen Image 2.1 Pro", apiModel: "qwen-image-2.1-pro", pricePerImage: 0.04, maxRefImages: 10, supportsNegativePrompt: false },
    { key: "qwen-image-2.1-turbo", label: "Qwen Image 2.1 Turbo", apiModel: "qwen-image-2.1-turbo", pricePerImage: 0.016, maxRefImages: 10, supportsNegativePrompt: false },
  ],
  refTemplate: "image {n}",
};

const MODEL_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function getCatalog(db: Database): Catalog {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get("catalog");
  if (!row) return structuredClone(DEFAULT_CATALOG);
  try {
    return validateCatalog(JSON.parse(row.value));
  } catch {
    // A corrupt settings row should not brick the app; fall back to defaults.
    return structuredClone(DEFAULT_CATALOG);
  }
}

export function saveCatalog(db: Database, input: unknown): Catalog {
  const catalog = validateCatalog(input);
  db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    "catalog",
    JSON.stringify(catalog),
  );
  return catalog;
}

function validateModel(raw: unknown, i: number): CatalogModel {
  if (!isRecord(raw)) throw new HttpError(400, `models[${i}] must be an object`);
  const { key, label, apiModel, pricePerImage, pricePerImage2k, maxRefImages, supportsNegativePrompt } = raw;
  if (typeof key !== "string" || !MODEL_KEY_RE.test(key)) throw new HttpError(400, `models[${i}].key is invalid`);
  if (typeof label !== "string" || !label.trim()) throw new HttpError(400, `models[${i}].label must be a non-empty string`);
  if (typeof apiModel !== "string" || !apiModel.trim() || apiModel.length > 128) {
    throw new HttpError(400, `models[${i}].apiModel must be a non-empty string`);
  }
  if (typeof pricePerImage !== "number" || !Number.isFinite(pricePerImage) || pricePerImage < 0) {
    throw new HttpError(400, `models[${i}].pricePerImage must be a number >= 0`);
  }
  if (pricePerImage2k !== undefined && pricePerImage2k !== null &&
      (typeof pricePerImage2k !== "number" || !Number.isFinite(pricePerImage2k) || pricePerImage2k < 0)) {
    throw new HttpError(400, `models[${i}].pricePerImage2k must be a number >= 0 or omitted`);
  }
  if (typeof maxRefImages !== "number" || !Number.isInteger(maxRefImages) || maxRefImages < 0 || maxRefImages > 100) {
    throw new HttpError(400, `models[${i}].maxRefImages must be an integer 0..100`);
  }
  if (typeof supportsNegativePrompt !== "boolean") throw new HttpError(400, `models[${i}].supportsNegativePrompt must be boolean`);
  return {
    key, label: label.trim(), apiModel: apiModel.trim(), pricePerImage,
    ...(typeof pricePerImage2k === "number" ? { pricePerImage2k } : {}),
    maxRefImages, supportsNegativePrompt,
  };
}

export function validateCatalog(input: unknown): Catalog {
  if (!isRecord(input)) throw new HttpError(400, "Catalog must be an object");
  if (!Array.isArray(input.models) || input.models.length === 0) throw new HttpError(400, "'models' must be a non-empty array");
  const models = input.models.map(validateModel);
  if (new Set(models.map((m) => m.key)).size !== models.length) throw new HttpError(400, "Model keys must be unique");
  const refTemplate = input.refTemplate;
  if (typeof refTemplate !== "string" || !refTemplate.includes("{n}") || refTemplate.length > 200) {
    throw new HttpError(400, "'refTemplate' must be a string containing {n} (max 200 chars)");
  }
  return { models, refTemplate };
}
