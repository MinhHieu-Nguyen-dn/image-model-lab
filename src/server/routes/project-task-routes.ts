/** Project and task CRUD endpoints. */
import { json, readJsonObject, requireName } from "../http-utils.ts";
import type { Router } from "../router.ts";
import {
  createProject, createTask, deleteProject, deleteTask, getTask, listProjects, listTasks, renameProject, updateTask,
} from "../project-task-store.ts";

export function registerProjectTaskRoutes(router: Router): void {
  router
    .add("GET", "/api/projects", (_req, _p, ctx) => json(listProjects(ctx)))
    .add("POST", "/api/projects", async (req, _p, ctx) => json(createProject(ctx, requireName(await readJsonObject(req))), 201))
    .add("PATCH", "/api/projects/:pid", async (req, p, ctx) => json(renameProject(ctx, p.pid, requireName(await readJsonObject(req)))))
    .add("DELETE", "/api/projects/:pid", (_req, p, ctx) => {
      deleteProject(ctx, p.pid);
      return json({ ok: true });
    })
    .add("GET", "/api/projects/:pid/tasks", (_req, p, ctx) => json(listTasks(ctx, p.pid)))
    .add("POST", "/api/projects/:pid/tasks", async (req, p, ctx) => json(createTask(ctx, p.pid, requireName(await readJsonObject(req))), 201))
    .add("GET", "/api/tasks/:tid", (_req, p, ctx) => json(getTask(ctx, p.tid)))
    .add("PATCH", "/api/tasks/:tid", async (req, p, ctx) => json(updateTask(ctx, p.tid, await readJsonObject(req))))
    .add("DELETE", "/api/tasks/:tid", (_req, p, ctx) => {
      deleteTask(ctx, p.tid);
      return json({ ok: true });
    });
}
