/**
 * Central in-memory state, a tiny pub/sub bus, and persisted "last view" pointers.
 *
 * Events: 'projects' (sidebar), 'main' (re-render main area), 'catalog', 'runs'.
 */

export const state = {
  view: 'project', // 'project' | 'settings'
  projects: [],
  projectId: null,
  tasks: [],
  tasksLoading: false,
  taskId: null,
  task: null, // full Task JSON of the open task; the editor mutates it in place
  taskLoading: false,
  catalog: { models: [], refTemplate: 'image {n}' },
  runs: [],
  runsTaskId: null,
  runsLoading: false,
  selectedRunId: null,
};

const listeners = new Map();

/** Subscribe to an event; returns an unsubscribe function. */
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

/** Notify subscribers; one failing listener never breaks the others. */
export function emit(event, payload) {
  for (const fn of [...(listeners.get(event) ?? [])]) {
    try { fn(payload); } catch (err) { console.error(`Listener for "${event}" failed`, err); }
  }
}

const PREFIX = 'qwen-image-studio:';

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null'); } catch { return null; }
}

function writeJson(key, value) {
  // Storage may be unavailable (private mode / quota); remembering the view is best-effort only.
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* best-effort */ }
}

/** Remembered navigation so selecting a project/app reload restores the last view. */
export const memory = {
  getLastView: () => readJson('last-view'),
  setLastView: (value) => writeJson('last-view', value),
  getLastTask: (projectId) => readJson(`last-task:${projectId}`),
  setLastTask: (projectId, taskId) => writeJson(`last-task:${projectId}`, taskId),
};

export function currentProject() {
  return state.projects.find((p) => p.id === state.projectId) ?? null;
}

export function catalogModel(key) {
  return state.catalog.models.find((m) => m.key === key) ?? null;
}
