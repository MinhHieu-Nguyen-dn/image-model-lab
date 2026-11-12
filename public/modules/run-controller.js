/**
 * Runs: start (POST /api/tasks/:tid/runs), load history, and poll GET /api/runs/:rid
 * about every second until status is "done". Polling continues across task switches;
 * results only update state when the run belongs to the task currently shown.
 */
import { state, emit } from './app-state.js';
import { api, enc, asArray } from './api-client.js';
import { reportError, showToast } from './toast-notifications.js';
import { flushAutosave } from './task-autosave.js';

const polling = new Set();
const MAX_POLL_FAILURES = 10;

/** Ratings saved this session, so a poll response read before the save cannot revert them. */
const savedRatings = new Map();
const ratingKey = (runId, modelKey, index) => `${runId}|${modelKey}|${index}`;

function applySavedRatings(run) {
  for (const result of run.results ?? []) {
    (result.images ?? []).forEach((image, index) => {
      const key = ratingKey(run.id, result.modelKey, index);
      if (!savedRatings.has(key)) return;
      const rating = savedRatings.get(key);
      if (rating) image.rating = rating;
      else delete image.rating;
    });
  }
}

function upsertRun(run) {
  if (!run || state.runsTaskId !== run.taskId) return;
  applySavedRatings(run);
  const index = state.runs.findIndex((r) => r.id === run.id);
  if (index >= 0) state.runs[index] = run;
  else state.runs.unshift(run);
}

function summarize(run) {
  const results = run.results ?? [];
  const ok = results.filter((r) => r.status === 'ok').length;
  return { ok, failed: results.length - ok, total: results.length };
}

/**
 * Mirror a saved rating into the loaded run history. Cards are reused across polls, so the
 * image object a card mutated may no longer be the one held in state.runs.
 */
export function recordRating(runId, modelKey, index, rating) {
  savedRatings.set(ratingKey(runId, modelKey, index), rating);
  const image = state.runs.find((r) => r.id === runId)?.results?.find((r) => r.modelKey === modelKey)?.images?.[index];
  if (!image) return;
  if (rating) image.rating = rating;
  else delete image.rating;
}

export function pollRun(runId) {
  if (polling.has(runId)) return;
  polling.add(runId);
  let failures = 0;
  const tick = async () => {
    try {
      const run = await api.get(`/api/runs/${enc(runId)}`);
      failures = 0;
      upsertRun(run);
      emit('runs');
      if (run.status === 'done') {
        polling.delete(runId);
        const { ok, failed, total } = summarize(run);
        showToast(`Run finished: ${ok}/${total} model${total === 1 ? '' : 's'} succeeded${failed ? `, ${failed} failed` : ''}.`,
          failed && !ok ? 'error' : 'success');
        return;
      }
    } catch (err) {
      if (err?.status === 404) { // run (or its task/project) was deleted: nothing left to watch
        polling.delete(runId);
        return;
      }
      failures += 1;
      if (failures === 1) reportError(err, 'Lost contact while checking run status (retrying)');
      if (failures >= MAX_POLL_FAILURES) {
        polling.delete(runId);
        showToast('Stopped checking run status. Reopen the task to refresh.', 'error');
        return;
      }
    }
    setTimeout(tick, failures ? Math.min(1000 * 2 ** failures, 8000) : 1000);
  };
  setTimeout(tick, 1000);
}

/** Load run history for a task (newest first) and resume polling unfinished runs. */
export async function loadRuns(taskId) {
  try {
    const runs = asArray(await api.get(`/api/tasks/${enc(taskId)}/runs`), 'runs');
    if (state.runsTaskId !== taskId) return;
    state.runs = runs;
    if (!runs.some((r) => r.id === state.selectedRunId)) state.selectedRunId = runs[0]?.id ?? null;
    runs.filter((r) => r.status !== 'done').forEach((r) => pollRun(r.id));
  } catch (err) {
    reportError(err, 'Could not load run history');
  }
}

/** Save pending edits, start a run for the selected models, select it and poll it. */
export async function startRun(task) {
  if (!(task.models ?? []).length) {
    showToast('Select at least one model to run.', 'error');
    return;
  }
  if ((await flushAutosave()) === false) {
    showToast('Task changes could not be saved, so the run was not started.', 'error');
    return;
  }
  try {
    const run = await api.post(`/api/tasks/${enc(task.id)}/runs`, { models: task.models });
    upsertRun(run);
    state.selectedRunId = run.id;
    emit('runs');
    if (run.status !== 'done') pollRun(run.id);
  } catch (err) {
    reportError(err, 'Run could not be started');
  }
}
