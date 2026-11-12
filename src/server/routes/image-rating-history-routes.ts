/** Image rating (like/dislike) and cross-run image history endpoints. */
import { HttpError, json, readJsonObject } from "../http-utils.ts";
import { listImageHistory, parseBooleanFilter, parseRatingFilter, type HistoryFilters } from "../image-history-store.ts";
import { buildHistoryZip } from "../history-zip-download.ts";
import { parseRating, setImageRating } from "../image-rating-store.ts";
import type { Router } from "../router.ts";

/** The History filters carried by a query string (shared by the list and the ZIP download). */
function historyFilters(q: URLSearchParams): HistoryFilters {
  return {
    projectIds: q.getAll("projectId").filter(Boolean),
    taskIds: q.getAll("taskId").filter(Boolean),
    promptExtend: parseBooleanFilter("promptExtend", q.get("promptExtend")),
    modelKey: q.get("model") || undefined,
    rating: parseRatingFilter(q.get("rating")),
  };
}

export function registerImageRatingHistoryRoutes(router: Router): void {
  router
    .add("PUT", "/api/runs/:rid/results/:modelKey/images/:idx/rating", async (req, p, ctx) => {
      if (!/^\d+$/.test(p.idx)) throw new HttpError(404, "Image not found");
      const body = await readJsonObject(req);
      if (!("rating" in body)) throw new HttpError(400, "'rating' is required (\"like\", \"dislike\" or null)");
      const rating = setImageRating(ctx, p.rid, p.modelKey, Number(p.idx), parseRating(body.rating));
      return json({ runId: p.rid, modelKey: p.modelKey, imageIndex: Number(p.idx), rating });
    })
    .add("GET", "/api/history", (req, _p, ctx) => json(listImageHistory(ctx, historyFilters(new URL(req.url).searchParams))))
    .add("GET", "/api/history/download", (req, _p, ctx) =>
      buildHistoryZip(ctx, listImageHistory(ctx, historyFilters(new URL(req.url).searchParams)).images),
    );
}
