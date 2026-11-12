/**
 * Cross-run image history: every generated image with where it came from and its rating,
 * plus per-model like/dislike counts. Filtering by project/model/rating narrows the images;
 * the per-model summary honours the project filter only, so it keeps showing every model's
 * counts while the image list is narrowed to one model or rating.
 */
import type { AppContext } from "./app-context.ts";
import { HttpError } from "./http-utils.ts";
import type { ImageRating } from "./image-rating-store.ts";
import type { ModelResult, ResultImage } from "./run-store.ts";

export type RatingFilter = ImageRating | "unrated";

export interface HistoryFilters {
  projectId?: string;
  modelKey?: string;
  rating?: RatingFilter;
}

export interface HistoryImage {
  runId: string;
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  modelKey: string;
  modelLabel: string;
  apiModel: string;
  imageIndex: number;
  image: ResultImage;
}

export interface ModelSummary {
  modelKey: string;
  label: string;
  images: number;
  likes: number;
  dislikes: number;
  unrated: number;
}

export interface HistoryResponse {
  images: HistoryImage[];
  models: ModelSummary[];
  projects: Array<{ id: string; name: string }>;
}

interface HistoryRow {
  run_id: string;
  created_at: string;
  task_id: string;
  task_name: string;
  project_id: string;
  project_name: string;
  data: string;
  ratings: string | null;
}

export function parseRatingFilter(value: string | null): RatingFilter | undefined {
  if (!value) return undefined;
  if (value === "like" || value === "dislike" || value === "unrated") return value;
  throw new HttpError(400, "'rating' must be like, dislike or unrated");
}

export function listImageHistory(ctx: AppContext, filters: HistoryFilters): HistoryResponse {
  // Newest runs first; within a run, results keep their model order.
  const rows = ctx.db
    .query<HistoryRow, []>(
      `SELECT r.id AS run_id, r.created_at, t.id AS task_id, t.name AS task_name,
              p.id AS project_id, p.name AS project_name, rr.data,
              (SELECT json_group_object(model_key || '#' || img_idx, rating) FROM image_ratings WHERE run_id = r.id) AS ratings
       FROM run_results rr
       JOIN runs r ON r.id = rr.run_id
       JOIN tasks t ON t.id = r.task_id
       JOIN projects p ON p.id = t.project_id
       ORDER BY r.created_at DESC, r.rowid DESC, rr.idx ASC`,
    )
    .all();

  const projects = new Map<string, string>();
  const summary = new Map<string, ModelSummary>();
  const images: HistoryImage[] = [];

  for (const row of rows) {
    projects.set(row.project_id, row.project_name);
    if (filters.projectId && row.project_id !== filters.projectId) continue;
    const result = JSON.parse(row.data) as ModelResult;
    if (!result.images?.length) continue;
    const ratings = row.ratings ? (JSON.parse(row.ratings) as Record<string, ImageRating>) : {};
    const counts =
      summary.get(result.modelKey) ?? { modelKey: result.modelKey, label: result.label, images: 0, likes: 0, dislikes: 0, unrated: 0 };
    summary.set(result.modelKey, counts);

    result.images.forEach((image, imageIndex) => {
      const rating = ratings[`${result.modelKey}#${imageIndex}`];
      counts.images += 1;
      if (rating === "like") counts.likes += 1;
      else if (rating === "dislike") counts.dislikes += 1;
      else counts.unrated += 1;

      if (filters.modelKey && result.modelKey !== filters.modelKey) return;
      if (filters.rating && (rating ?? "unrated") !== filters.rating) return;
      images.push({
        runId: row.run_id,
        taskId: row.task_id,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        createdAt: row.created_at,
        modelKey: result.modelKey,
        modelLabel: result.label,
        apiModel: result.apiModel,
        imageIndex,
        image: rating ? { ...image, rating } : image,
      });
    });
  }

  return {
    images,
    models: [...summary.values()].sort((a, b) => a.label.localeCompare(b.label)),
    projects: [...projects].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
