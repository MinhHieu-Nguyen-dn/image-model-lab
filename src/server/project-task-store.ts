/**
 * Projects and tasks persistence (SQLite rows <-> API JSON) plus file cleanup
 * under images/ on delete.
 */
import { rmSync } from "node:fs";
import type { AppContext } from "./app-context.ts";
import { newId, nowIso } from "./db.ts";
import { HttpError } from "./http-utils.ts";
import { projectDir, taskDir } from "./paths.ts";
import { deleteProjectAuth } from "./model-studio-auth-store.ts";
import { getCatalog } from "./catalog-store.ts";
import { listRefs, type RefJson } from "./ref-store.ts";
import { validateModelKeys, validateN, validateSeed, validateSize } from "./generation-params-validation.ts";

export interface ProjectJson {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskJson {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  negativePrompt: string;
  size: string;
  n: number;
  seed: number | null;
  promptExtend: boolean;
  models: string[];
  refs: RefJson[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow { id: string; name: string; created_at: string; updated_at: string }
interface TaskRow {
  id: string; project_id: string; name: string; prompt: string; negative_prompt: string; size: string;
  n: number; seed: number | null; prompt_extend: number; models: string; created_at: string; updated_at: string;
}

const toProject = (r: ProjectRow): ProjectJson => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at });

export function listProjects(ctx: AppContext): ProjectJson[] {
  return ctx.db.query<ProjectRow, []>("SELECT * FROM projects ORDER BY created_at ASC").all().map(toProject);
}

export function getProject(ctx: AppContext, pid: string): ProjectJson {
  const row = ctx.db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(pid);
  if (!row) throw new HttpError(404, "Project not found");
  return toProject(row);
}

export function createProject(ctx: AppContext, name: string): ProjectJson {
  const id = newId("p");
  const now = nowIso();
  ctx.db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
  return getProject(ctx, id);
}

export function renameProject(ctx: AppContext, pid: string, name: string): ProjectJson {
  getProject(ctx, pid);
  ctx.db.query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), pid);
  return getProject(ctx, pid);
}

/** Deletes the project rows (cascade), its files and its credential override. */
export function deleteProject(ctx: AppContext, pid: string): void {
  getProject(ctx, pid);
  ctx.db.query("DELETE FROM projects WHERE id = ?").run(pid);
  rmSync(projectDir(ctx.imagesDir, pid), { recursive: true, force: true });
  try {
    deleteProjectAuth(ctx.imagesDir, pid);
  } catch (err) {
    // Unreadable credentials file: the project is already gone; an orphaned override is harmless
    // (it is keyed by an id that no longer exists) and must not turn the delete into a 500.
    // Log only the error class/code, never a message that could echo file contents.
    console.error(`Could not remove the credential override of deleted project ${pid}: ${(err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? "error"}`);
  }
}

function toTask(ctx: AppContext, r: TaskRow): TaskJson {
  let models: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.models);
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
  } catch {
    models = [];
  }
  return {
    id: r.id, projectId: r.project_id, name: r.name, prompt: r.prompt, negativePrompt: r.negative_prompt,
    size: r.size, n: r.n, seed: r.seed, promptExtend: !!r.prompt_extend, models,
    refs: listRefs(ctx, r.project_id, r.id), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listTasks(ctx: AppContext, pid: string): TaskJson[] {
  getProject(ctx, pid);
  return ctx.db
    .query<TaskRow, [string]>("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(pid)
    .map((r) => toTask(ctx, r));
}

export function getTask(ctx: AppContext, tid: string): TaskJson {
  const row = ctx.db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?").get(tid);
  if (!row) throw new HttpError(404, "Task not found");
  return toTask(ctx, row);
}

export function createTask(ctx: AppContext, pid: string, name: string): TaskJson {
  getProject(ctx, pid);
  const id = newId("t");
  const now = nowIso();
  const defaultModels = JSON.stringify(getCatalog(ctx.db).models.slice(0, 1).map((m) => m.key));
  ctx.db
    .query("INSERT INTO tasks (id, project_id, name, models, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, pid, name, defaultModels, now, now);
  return getTask(ctx, id);
}

/** Partial update; every provided field is validated before anything is written. */
export function updateTask(ctx: AppContext, tid: string, body: Record<string, unknown>): TaskJson {
  getTask(ctx, tid);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const add = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "'name' must be a non-empty string");
    add("name", body.name.trim().slice(0, 200));
  }
  if ("prompt" in body) {
    if (typeof body.prompt !== "string") throw new HttpError(400, "'prompt' must be a string");
    add("prompt", body.prompt);
  }
  if ("negativePrompt" in body) {
    if (typeof body.negativePrompt !== "string") throw new HttpError(400, "'negativePrompt' must be a string");
    add("negative_prompt", body.negativePrompt);
  }
  if ("size" in body) add("size", validateSize(body.size));
  if ("n" in body) add("n", validateN(body.n));
  if ("seed" in body) add("seed", validateSeed(body.seed));
  if ("promptExtend" in body) {
    if (typeof body.promptExtend !== "boolean") throw new HttpError(400, "'promptExtend' must be boolean");
    add("prompt_extend", body.promptExtend ? 1 : 0);
  }
  if ("models" in body) {
    const keys = getCatalog(ctx.db).models.map((m) => m.key);
    add("models", JSON.stringify(validateModelKeys(body.models, keys, true)));
  }
  if (sets.length) {
    add("updated_at", nowIso());
    ctx.db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values, tid);
  }
  return getTask(ctx, tid);
}

export function deleteTask(ctx: AppContext, tid: string): void {
  const task = getTask(ctx, tid);
  ctx.db.query("DELETE FROM tasks WHERE id = ?").run(tid);
  rmSync(taskDir(ctx.imagesDir, task.projectId, tid), { recursive: true, force: true });
}
