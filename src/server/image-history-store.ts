/**
 * Cross-run image history: every generated image with where it came from and its rating,
 * plus per-model like/dislike counts, each split by prompt_extend on/off. Project and task select
 * which runs are in scope and narrow both the images and the summary; model, prompt-extend and
 * rating narrow only the images, so the summary keeps showing every model's counts (and the
 * on/off split) while the list is narrowed. Project and task accept several ids: a run is in scope
 * when its project is among the selected projects and its task among the selected tasks.
 */
import type { AppContext } from "./app-context.ts";
import { HttpError } from "./http-utils.ts";
import type { ImageRating } from "./image-rating-store.ts";
import type { ModelResult, ResultImage, RunInputs } from "./run-store.ts";

export type RatingFilter = ImageRating | "unrated";

export interface HistoryFilters {
  /** Only these projects; empty or absent means all. */
  projectIds?: string[];
  /** Only these tasks; empty or absent means all. */
  taskIds?: string[];
  /** Only runs started with prompt_extend on (true) or off (false). */
  promptExtend?: boolean;
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

export interface RatingCounts {
  images: number;
  likes: number;
  dislikes: number;
  unrated: number;
}

export interface ModelSummary extends RatingCounts {
  modelKey: string;
  label: string;
  /** The same counts for runs started with prompt_extend on / off. */
  promptExtend: { on: RatingCounts; off: RatingCounts };
}

const emptyCounts = (): RatingCounts => ({ images: 0, likes: 0, dislikes: 0, unrated: 0 });

function tally(counts: RatingCounts, rating: ImageRating | undefined): void {
  counts.images += 1;
  if (rating === "like") counts.likes += 1;
  else if (rating === "dislike") counts.dislikes += 1;
  else counts.unrated += 1;
}

export interface HistoryResponse {
  images: HistoryImage[];
  models: ModelSummary[];
  projects: Array<{ id: string; name: string }>;
  /** Tasks with generated images, within the project filter. */
  tasks: Array<{ id: string; name: string; projectId: string; projectName: string }>;
}

interface HistoryRow {
  run_id: string;
  created_at: string;
  task_id: string;
  task_name: string;
  project_id: string;
  project_name: string;
  data: string;
  inputs: string;
  ratings: string | null;
}

export function parseRatingFilter(value: string | null): RatingFilter | undefined {
  if (!value) return undefined;
  if (value === "like" || value === "dislike" || value === "unrated") return value;
  throw new HttpError(400, "'rating' must be like, dislike or unrated");
}

export function parseBooleanFilter(name: string, value: string | null): boolean | undefined {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, `'${name}' must be true or false`);
}

export function listImageHistory(ctx: AppContext, filters: HistoryFilters): HistoryResponse {
  // Newest runs first; within a run, results keep their model order.
  const rows = ctx.db
    .query<HistoryRow, []>(
      `SELECT r.id AS run_id, r.created_at, t.id AS task_id, t.name AS task_name,
              p.id AS project_id, p.name AS project_name, rr.data, r.inputs,
              (SELECT json_group_object(model_key || '#' || img_idx, rating) FROM image_ratings WHERE run_id = r.id) AS ratings
       FROM run_results rr
       JOIN runs r ON r.id = rr.run_id
       JOIN tasks t ON t.id = r.task_id
       JOIN projects p ON p.id = t.project_id
       ORDER BY r.created_at DESC, r.rowid DESC, rr.idx ASC`,
    )
    .all();

  const projectScope = filters.projectIds?.length ? new Set(filters.projectIds) : null;
  const taskScope = filters.taskIds?.length ? new Set(filters.taskIds) : null;
  const projects = new Map<string, string>();
  const tasks = new Map<string, { id: string; name: string; projectId: string; projectName: string }>();
  const summary = new Map<string, ModelSummary>();
  const images: HistoryImage[] = [];

  for (const row of rows) {
    projects.set(row.project_id, row.project_name);
    if (projectScope && !projectScope.has(row.project_id)) continue;
    tasks.set(row.task_id, { id: row.task_id, name: row.task_name, projectId: row.project_id, projectName: row.project_name });
    if (taskScope && !taskScope.has(row.task_id)) continue;
    const result = JSON.parse(row.data) as ModelResult;
    if (!result.images?.length) continue;
    const ratings = row.ratings ? (JSON.parse(row.ratings) as Record<string, ImageRating>) : {};
    const promptExtend = !!(JSON.parse(row.inputs) as RunInputs).promptExtend;
    const counts =
      summary.get(result.modelKey) ??
      { modelKey: result.modelKey, label: result.label, ...emptyCounts(), promptExtend: { on: emptyCounts(), off: emptyCounts() } };
    summary.set(result.modelKey, counts);

    result.images.forEach((image, imageIndex) => {
      const rating = ratings[`${result.modelKey}#${imageIndex}`];
      tally(counts, rating);
      tally(promptExtend ? counts.promptExtend.on : counts.promptExtend.off, rating);

      if (filters.modelKey && result.modelKey !== filters.modelKey) return;
      if (filters.promptExtend !== undefined && promptExtend !== filters.promptExtend) return;
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
    tasks: [...tasks.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name)),
  };
}
