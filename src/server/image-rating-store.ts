/**
 * Like / dislike ratings for generated images. An image is identified by
 * (run id, model key, index in that model's `images` array); the row cascades away
 * with its run, so deleting a task or project also drops its ratings.
 */
import type { AppContext } from "./app-context.ts";
import { nowIso } from "./db.ts";
import { HttpError } from "./http-utils.ts";
import type { ModelResult } from "./run-store.ts";

export type ImageRating = "like" | "dislike";

export function parseRating(value: unknown): ImageRating | null {
  if (value === null || value === undefined) return null;
  if (value === "like" || value === "dislike") return value;
  throw new HttpError(400, "'rating' must be \"like\", \"dislike\" or null");
}

/** Sets (or, with null, clears) one image's rating. Returns the stored rating. */
export function setImageRating(ctx: AppContext, runId: string, modelKey: string, index: number, rating: ImageRating | null): ImageRating | null {
  const row = ctx.db
    .query<{ data: string }, [string, string]>("SELECT data FROM run_results WHERE run_id = ? AND model_key = ?")
    .get(runId, modelKey);
  if (!row) throw new HttpError(404, "Run result not found");
  const result = JSON.parse(row.data) as ModelResult;
  if (!Number.isInteger(index) || index < 0 || index >= result.images.length) throw new HttpError(404, "Image not found");
  if (rating === null) {
    ctx.db.query("DELETE FROM image_ratings WHERE run_id = ? AND model_key = ? AND img_idx = ?").run(runId, modelKey, index);
  } else {
    ctx.db
      .query(
        `INSERT INTO image_ratings (run_id, model_key, img_idx, rating, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (run_id, model_key, img_idx) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      )
      .run(runId, modelKey, index, rating, nowIso());
  }
  return rating;
}

/** Ratings of one run keyed `${modelKey}#${index}`. */
export function ratingsForRun(ctx: AppContext, runId: string): Map<string, ImageRating> {
  const rows = ctx.db
    .query<{ model_key: string; img_idx: number; rating: ImageRating }, [string]>(
      "SELECT model_key, img_idx, rating FROM image_ratings WHERE run_id = ?",
    )
    .all(runId);
  return new Map(rows.map((r) => [`${r.model_key}#${r.img_idx}`, r.rating]));
}
