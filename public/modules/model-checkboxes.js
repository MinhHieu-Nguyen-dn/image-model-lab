/**
 * Model multi-select from the catalog, with proactive over-limit warnings
 * (more reference images than the model's maxRefImages ⇒ that card will fail, no API call).
 */
import { h, clear } from './dom-helpers.js';
import { state } from './app-state.js';
import { formatCost } from './format-helpers.js';

export function createModelCheckboxes({ task, onChange }) {
  const el = h('fieldset', { class: 'model-list' });

  function toggle(key, checked) {
    const selected = new Set(task.models ?? []);
    if (checked) selected.add(key); else selected.delete(key);
    // Keep catalog order so results always appear in a stable order.
    onChange(state.catalog.models.map((m) => m.key).filter((k) => selected.has(k)));
    render();
  }

  function render() {
    clear(el);
    el.append(h('legend', { class: 'field-label' }, 'Models'));
    const models = state.catalog.models;
    const refCount = task.refs?.length ?? 0;
    if (!models.length) {
      el.append(h('p', { class: 'muted' }, 'The model catalog is empty or not loaded.'));
      return;
    }
    for (const m of models) {
      const checked = (task.models ?? []).includes(m.key);
      const over = refCount > Number(m.maxRefImages);
      el.append(h('label', { class: `model-option${checked ? ' checked' : ''}${over && checked ? ' over-limit' : ''}` },
        h('input', { type: 'checkbox', checked, onChange: (e) => toggle(m.key, e.target.checked) }),
        h('span', { class: 'model-main' },
          h('span', { class: 'model-name' }, m.label || m.key),
          h('code', { class: 'muted small' }, m.apiModel)),
        h('span', { class: 'model-tags' },
          h('span', { class: 'tag' }, `max ${m.maxRefImages} refs`),
          h('span', { class: `tag${m.supportsNegativePrompt ? '' : ' tag-muted'}` },
            m.supportsNegativePrompt ? 'negative prompt' : 'no negative prompt'),
          Number(m.pricePerImage) > 0 ? h('span', { class: 'tag' }, `${formatCost(m.pricePerImage)}/img${m.pricePerImage2k !== undefined && m.pricePerImage2k !== m.pricePerImage ? ` · ${formatCost(m.pricePerImage2k)} at 2K` : ''}`) : null),
        over ? h('span', { class: 'model-warning', role: 'note' },
          `Over limit: ${refCount} reference images > max ${m.maxRefImages}. This model will fail without calling the API.`) : null));
    }
    if (!(task.models ?? []).length) {
      el.append(h('p', { class: 'field-note warn' }, 'Select at least one model to run.'));
    }
  }

  render();
  return { el, render };
}
