/** Catalog/settings, compile preview and run endpoints. */
import { getCatalog, saveCatalog } from "../catalog-store.ts";
import { json, readJsonObject } from "../http-utils.ts";
import { getTask } from "../project-task-store.ts";
import type { Router } from "../router.ts";
import { getRun, listRuns } from "../run-store.ts";
import { startRun } from "../runner.ts";
import { compileTask, toCompileResponse } from "../task-compile-service.ts";

export function registerCatalogCompileRunRoutes(router: Router): void {
  router
    .add("GET", "/api/catalog", (_req, _p, ctx) => json(getCatalog(ctx.db)))
    .add("PUT", "/api/catalog", async (req, _p, ctx) => json(saveCatalog(ctx.db, await readJsonObject(req))))
    .add("POST", "/api/tasks/:tid/compile", async (req, p, ctx) => {
      const body = await readJsonObject(req);
      return json(toCompileResponse(compileTask(ctx, p.tid, body.models)));
    })
    .add("POST", "/api/tasks/:tid/runs", async (req, p, ctx) => {
      const body = await readJsonObject(req);
      return json(startRun(ctx, p.tid, body.models), 202);
    })
    .add("GET", "/api/tasks/:tid/runs", (_req, p, ctx) => {
      getTask(ctx, p.tid);
      return json(listRuns(ctx, p.tid));
    })
    .add("GET", "/api/runs/:rid", (_req, p, ctx) => json(getRun(ctx, p.rid)));
}
