/**
 * Task editor form: prompt (chip editor), negative prompt, reference images,
 * generation parameters, model selection and the View request / Run actions.
 * Every edit mutates the task in place and is autosaved (debounced PATCH).
 */
import { h, button } from './dom-helpers.js';
import { on, catalogModel } from './app-state.js';
import { queueTaskPatch } from './task-autosave.js';
import { createPromptChipEditor } from './prompt-chip-editor.js';
import { createRefImagesPanel } from './ref-images-panel.js';
import { createTaskParamsFields } from './task-params-fields.js';
import { createModelCheckboxes } from './model-checkboxes.js';

export function createTaskEditorForm(task, { onRun, onCompile }) {
  const offs = [];
  const save = (fields) => {
    Object.assign(task, fields);
    queueTaskPatch(task.id, fields);
  };

  const refsPanel = createRefImagesPanel({
    task,
    onRefsChanged: () => { promptEditor.refreshChips(); models.render(); },
    onRefRemoved: (refId) => promptEditor.stripRef(refId),
  });
  const promptEditor = createPromptChipEditor({
    value: task.prompt ?? '',
    getRefs: () => task.refs ?? [],
    onChange: (prompt) => save({ prompt }),
    onFiles: (files) => refsPanel.upload(files),
  });

  const negativeNote = h('p', { class: 'field-note warn', hidden: true });
  const negative = h('textarea', {
    rows: 2, value: task.negativePrompt ?? '', placeholder: 'What to avoid (optional)',
    onInput: (e) => save({ negativePrompt: e.target.value }),
  });

  /** Warn which selected models will not receive the negative prompt. */
  function updateNegativeNote() {
    const unsupported = (task.models ?? []).map(catalogModel).filter((m) => m && !m.supportsNegativePrompt);
    const hasText = Boolean(String(task.negativePrompt ?? '').trim());
    negativeNote.hidden = !unsupported.length;
    negativeNote.textContent = unsupported.length
      ? `${hasText ? 'Not sent' : 'Would not be sent'} to ${unsupported.map((m) => m.label || m.key).join(', ')} (no negative_prompt support); omitted from their requests.`
      : '';
  }
  negative.addEventListener('input', updateNegativeNote);

  const models = createModelCheckboxes({
    task,
    onChange: (keys) => { save({ models: keys }); updateNegativeNote(); updateActions(); },
  });

  const runBtn = button('Run', () => onRun(), { variant: 'primary' });
  const compileBtn = button('View request', () => onCompile());
  function updateActions() {
    const none = !(task.models ?? []).length;
    runBtn.disabled = none;
    compileBtn.disabled = none;
    runBtn.title = none ? 'Select at least one model' : 'Run all selected models in parallel';
  }

  offs.push(on('catalog', () => { models.render(); updateNegativeNote(); }));
  updateNegativeNote();
  updateActions();

  const el = h('div', { class: 'editor-grid' },
    h('div', { class: 'editor-main stack' },
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Prompt'),
        promptEditor.el,
        h('span', { class: 'field-note' }, 'Type @ to insert a reference image chip; chips compile to the reference template (e.g. "image 1").')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Negative prompt'), negative, negativeNote),
      refsPanel.el),
    h('div', { class: 'editor-side stack' },
      createTaskParamsFields(task, save),
      models.el,
      h('div', { class: 'row actions' }, compileBtn, runBtn)));

  return {
    el,
    dispose: () => { offs.forEach((off) => off()); promptEditor.dispose(); },
  };
}
