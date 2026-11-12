/**
 * Generation parameter fields: size, n (1-6), optional seed, prompt_extend.
 * Each valid change calls save(fields); invalid input shows an inline error and is not saved.
 */
import { h } from './dom-helpers.js';
import { createSizeField } from './size-field.js';

const MAX_SEED = 2147483647;

export function createTaskParamsFields(task, save) {
  const size = createSizeField({ value: task.size ?? '1024*1024', onChange: (value) => save({ size: value }) });

  const n = h('select', { 'aria-label': 'Images per model', onChange: (e) => save({ n: Number(e.target.value) }) },
    [1, 2, 3, 4, 5, 6].map((v) => h('option', { value: String(v), selected: v === Number(task.n ?? 1) }, String(v))));

  const seedError = h('p', { class: 'field-note error', hidden: true });
  const seed = h('input', {
    type: 'number', min: 0, max: MAX_SEED, step: 1, placeholder: 'Random',
    value: task.seed === null || task.seed === undefined ? '' : String(task.seed),
    onInput: (e) => {
      const raw = e.target.value.trim();
      const value = Number(raw);
      const valid = raw === '' || (Number.isInteger(value) && value >= 0 && value <= MAX_SEED);
      seedError.hidden = valid;
      seedError.textContent = valid ? '' : `Seed must be a whole number from 0 to ${MAX_SEED}.`;
      if (valid) save({ seed: raw === '' ? null : value });
    },
  });

  const extend = h('input', {
    type: 'checkbox', checked: Boolean(task.promptExtend),
    onChange: (e) => save({ promptExtend: e.target.checked }),
  });

  return h('div', { class: 'params-grid' },
    size,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Images per model (n)'), n),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Seed (optional)'), seed, seedError),
    h('label', { class: 'check-field' }, extend,
      h('span', {}, 'Prompt extend', h('small', { class: 'muted block' }, 'Let the model rewrite/expand the prompt'))));
}
