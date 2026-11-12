/**
 * Task workspace: toolbar (name, autosave status, rename/delete), editor form and results.
 * Returns a dispose function that unsubscribes listeners.
 */
import { h, button } from './dom-helpers.js';
import { state, on } from './app-state.js';
import { setAutosaveStatusListener } from './task-autosave.js';
import { createTaskEditorForm } from './task-editor-form.js';
import { createRunResultsView } from './run-results-view.js';
import { startRun, loadRuns } from './run-controller.js';
import { openCompileRequest } from './compile-request-view.js';
import { applyRunInputs } from './rerun-with-inputs.js';
import { renameTask, deleteTask } from './navigation-controller.js';

const SAVE_LABELS = { dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'All changes saved', error: 'Save failed (will retry)' };

export function mountTaskWorkspace(host, task) {
  const saveStatus = h('span', { class: 'save-status small', 'aria-live': 'polite' }, 'All changes saved');
  setAutosaveStatusListener((status) => {
    saveStatus.textContent = SAVE_LABELS[status] ?? '';
    saveStatus.dataset.state = status;
  });

  const form = createTaskEditorForm(task, {
    onRun: () => startRun(task),
    onCompile: () => openCompileRequest(task),
  });
  const results = createRunResultsView({ onRerun: (run) => applyRunInputs(task, run) });

  host.append(
    h('div', { class: 'task-toolbar row between' },
      h('div', { class: 'row' }, h('h2', {}, task.name), saveStatus),
      h('div', { class: 'row' },
        button('Rename task', () => renameTask(task.id), { variant: 'ghost' }),
        button('Delete task', () => deleteTask(task.id), { variant: 'ghost danger' }))),
    h('section', { class: 'panel' }, form.el),
    results.el);

  const offRuns = on('runs', results.render);
  if (state.runsTaskId !== task.id) {
    state.runs = [];
    state.runsTaskId = task.id;
    state.selectedRunId = null;
    state.runsLoading = true;
    results.render();
    void loadRuns(task.id).finally(() => {
      if (state.runsTaskId !== task.id) return;
      state.runsLoading = false;
      results.render();
    });
  } else {
    results.render();
  }

  return () => {
    offRuns();
    form.dispose();
    setAutosaveStatusListener(null);
  };
}
