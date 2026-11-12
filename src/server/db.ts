/**
 * SQLite (bun:sqlite) database: schema creation and id generation.
 * Run results are stored one row per model so parallel model completions
 * update independent rows.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', negative_prompt TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '1024*1024', n INTEGER NOT NULL DEFAULT 1, seed INTEGER,
  prompt_extend INTEGER NOT NULL DEFAULT 0, models TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  rel_path TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, status TEXT NOT NULL, inputs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_results (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (run_id, model_key)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_refs_task ON refs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
`;

export function openDatabase(imagesDir: string): Database {
  const db = new Database(join(imagesDir, "studio.db"), { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

/** Short url-safe id with a type prefix, e.g. `p_1a2b3c4d5e6f`. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
