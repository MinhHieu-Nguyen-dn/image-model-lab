/** Image rating (like/dislike) and cross-run image history endpoints. */
import { HttpError, json, readJsonObject } from "../http-utils.ts";
import { listImageHistory, parseRatingFilter } from "../image-history-store.ts";
import { parseRating, setImageRating } from "../image-rating-store.ts";
import type { Router } from "../router.ts";

export function registerImageRatingHistoryRoutes(router: Router): void {
  router
    .add("PUT", "/api/runs/:rid/results/:modelKey/images/:idx/rating", async (req, p, ctx) => {
      if (!/^\d+$/.test(p.idx)) throw new HttpError(404, "Image not found");
      const body = await readJsonObject(req);
      if (!("rating" in body)) throw new HttpError(400, "'rating' is required (\"like\", \"dislike\" or null)");
      const rating = setImageRating(ctx, p.rid, p.modelKey, Number(p.idx), parseRating(body.rating));
      return json({ runId: p.rid, modelKey: p.modelKey, imageIndex: Number(p.idx), rating });
    })
    .add("GET", "/api/history", (req, _p, ctx) => {
      const q = new URL(req.url).searchParams;
      return json(
        listImageHistory(ctx, {
          projectId: q.get("projectId") || undefined,
          modelKey: q.get("model") || undefined,
          rating: parseRatingFilter(q.get("rating")),
        }),
      );
    });
}
