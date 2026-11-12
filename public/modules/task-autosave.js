/**
 * Debounced task autosave: field edits accumulate into one PATCH /api/tasks/:tid.
 * Saves are serialised through a promise chain; a failed patch is re-queued so the next
 * flush (or the Run button) retries instead of silently dropping the edit.
 */
import { api, enc } from './api-client.js';
import { reportError } from './toast-notifications.js';

let pending = null;
let pendingTaskId = null;
let timer = null;
let chain = Promise.resolve(true);
let statusListener = () => {};

/** Status callback receives 'dirty' | 'saving' | 'saved' | 'error'. */
export function setAutosaveStatusListener(fn) {
  statusListener = typeof fn === 'function' ? fn : () => {};
}

/** Queue fields for task `taskId`; saves after `delayMs` of inactivity. */
export function queueTaskPatch(taskId, fields, delayMs = 600) {
  if (pendingTaskId && pendingTaskId !== taskId) void flushAutosave();
  pendingTaskId = taskId;
  pending = { ...(pending ?? {}), ...fields };
  statusListener('dirty');
  clearTimeout(timer);
  timer = setTimeout(() => void flushAutosave(), delayMs);
}

/**
 * Run another task-mutating request (e.g. ref reorder) in the same queue as the field
 * saves, so a Run started afterwards (which flushes this chain) never overtakes it.
 * Resolves/rejects with the request's own outcome.
 */
export function enqueueSerial(fn) {
  const run = chain.then(() => fn());
  chain = run.then(() => true, () => true);
  return run;
}

/**
 * Send any pending patch now. Resolves true when everything queued so far is saved,
 * false when the latest save failed.
 */
export function flushAutosave() {
  clearTimeout(timer);
  timer = null;
  if (!pending) return chain;
  const body = pending;
  const taskId = pendingTaskId;
  pending = null;
  pendingTaskId = null;
  statusListener('saving');
  chain = chain.then(async () => {
    try {
      await api.patch(`/api/tasks/${enc(taskId)}`, body);
      if (!pending) statusListener('saved');
      return true;
    } catch (err) {
      // Re-queue unless a different task is already pending (then this edit is lost and reported).
      if (!pendingTaskId || pendingTaskId === taskId) {
        pending = { ...body, ...(pending ?? {}) };
        pendingTaskId = taskId;
      }
      statusListener('error');
      reportError(err, 'Autosave failed');
      return false;
    }
  });
  return chain;
}
