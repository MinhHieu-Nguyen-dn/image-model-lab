/**
 * "Re-run with these inputs": load a past run's stored inputs back into the editor
 * (prompt with chips, negative prompt, size, n, seed, prompt_extend, models and,
 * when all its refs still exist, their order). The user then presses Run.
 */
import { emit, state } from './app-state.js';
import { api, enc } from './api-client.js';
import { queueTaskPatch, flushAutosave } from './task-autosave.js';
import { showToast, reportError } from './toast-notifications.js';

export async function applyRunInputs(task, run) {
  const inputs = run.inputs ?? {};
  const fields = {
    prompt: inputs.prompt ?? '',
    negativePrompt: inputs.negativePrompt ?? '',
    size: inputs.size ?? task.size,
    n: inputs.n ?? task.n,
    seed: inputs.seed ?? null,
    promptExtend: Boolean(inputs.promptExtend),
  };
  const known = new Set(state.catalog.models.map((m) => m.key));
  const models = (run.results ?? []).map((r) => r.modelKey).filter((k) => known.has(k));
  if (models.length) fields.models = models;

  Object.assign(task, fields);
  queueTaskPatch(task.id, fields, 0);
  if ((await flushAutosave()) === false) return;

  const runRefIds = (Array.isArray(inputs.refs) ? inputs.refs : []).map((r) => r.id);
  const currentIds = (task.refs ?? []).map((r) => r.id);
  const missing = runRefIds.filter((id) => !currentIds.includes(id));
  if (missing.length) {
    showToast(`${missing.length} reference image(s) used by this run were deleted; their chips show as "@Image ?".`, 'error');
  } else if (runRefIds.length) {
    const ids = [...runRefIds, ...currentIds.filter((id) => !runRefIds.includes(id))];
    if (ids.join() !== currentIds.join()) {
      try {
        await api.put(`/api/tasks/${enc(task.id)}/refs/order`, { ids });
        const byId = new Map(task.refs.map((r) => [r.id, r]));
        task.refs = ids.map((id, i) => ({ ...byId.get(id), order: i }));
      } catch (err) {
        reportError(err, 'Could not restore reference image order');
      }
    }
  }
  showToast('Run inputs loaded into the editor.', 'success');
  emit('main');
}
