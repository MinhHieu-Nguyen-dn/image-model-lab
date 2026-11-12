/**
 * Model catalog editor: label, API model id, price/image (1K and optional 2K), max ref images and
 * negative_prompt support per model, plus the ref template. Saves via PUT /api/catalog.
 */
import { h, clear, button } from './dom-helpers.js';
import { state } from './app-state.js';
import { api } from './api-client.js';
import { reportError, showToast } from './toast-notifications.js';
import { loadCatalog } from './navigation-controller.js';

export function createCatalogEditor() {
  const tbody = h('tbody');
  const template = h('input', { type: 'text', spellcheck: false });
  let rows = [];

  function render() {
    clear(tbody);
    template.value = state.catalog.refTemplate ?? 'image {n}';
    rows = state.catalog.models.map((m) => {
      const inputs = {
        key: m.key,
        label: h('input', { type: 'text', value: m.label ?? '', 'aria-label': `${m.key} label` }),
        apiModel: h('input', { type: 'text', value: m.apiModel ?? '', spellcheck: false, 'aria-label': `${m.key} API model id` }),
        price: h('input', { type: 'number', min: 0, step: 'any', value: String(m.pricePerImage ?? 0), 'aria-label': `${m.key} price per image` }),
        price2k: h('input', { type: 'number', min: 0, step: 'any', placeholder: 'same', value: m.pricePerImage2k === undefined ? '' : String(m.pricePerImage2k), 'aria-label': `${m.key} price per image at 2K` }),
        maxRefs: h('input', { type: 'number', min: 0, max: 100, step: 1, value: String(m.maxRefImages ?? 0), 'aria-label': `${m.key} max reference images` }),
        negative: h('input', { type: 'checkbox', checked: Boolean(m.supportsNegativePrompt), 'aria-label': `${m.key} supports negative prompt` }),
      };
      tbody.append(h('tr', {},
        h('td', {}, h('code', { class: 'small' }, m.key)),
        h('td', {}, inputs.label), h('td', {}, inputs.apiModel), h('td', {}, inputs.price), h('td', {}, inputs.price2k),
        h('td', {}, inputs.maxRefs), h('td', { class: 'center' }, inputs.negative)));
      return inputs;
    });
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'Catalog not loaded.')));
  }

  /** Validate inputs; returns { body } or { error }. */
  function collect() {
    const models = [];
    for (const r of rows) {
      const label = r.label.value.trim();
      const apiModel = r.apiModel.value.trim();
      const price = Number(r.price.value);
      const maxRefs = Number(r.maxRefs.value);
      const price2kRaw = r.price2k.value.trim();
      const price2k = Number(price2kRaw);
      if (!label) return { error: `${r.key}: label is required.` };
      if (!apiModel) return { error: `${r.key}: API model id is required.` };
      if (r.price.value === '' || !Number.isFinite(price) || price < 0) return { error: `${r.key}: price must be a number ≥ 0.` };
      if (price2kRaw !== '' && (!Number.isFinite(price2k) || price2k < 0)) return { error: `${r.key}: 2K price must be a number ≥ 0 or empty.` };
      if (!Number.isInteger(maxRefs) || maxRefs < 0) return { error: `${r.key}: max ref images must be a whole number ≥ 0.` };
      models.push({ key: r.key, label, apiModel, pricePerImage: price, ...(price2kRaw === '' ? {} : { pricePerImage2k: price2k }), maxRefImages: maxRefs, supportsNegativePrompt: r.negative.checked });
    }
    const refTemplate = template.value;
    if (!refTemplate.includes('{n}')) return { error: 'Reference template must contain {n} (the image number).' };
    return { body: { models, refTemplate } };
  }

  async function save() {
    const { body, error } = collect();
    if (error) { showToast(error, 'error'); return; }
    saveBtn.disabled = true;
    try {
      await api.put('/api/catalog', body);
      await loadCatalog();
      render();
      showToast('Catalog saved.', 'success');
    } catch (err) {
      reportError(err, 'Could not save catalog');
    } finally {
      saveBtn.disabled = false;
    }
  }

  const saveBtn = button('Save catalog', null, { variant: 'primary', type: 'submit' });
  const el = h('form', { class: 'catalog-editor stack', onSubmit: (e) => { e.preventDefault(); void save(); } },
    h('div', { class: 'table-wrap' },
      h('table', { class: 'catalog-table' },
        h('thead', {}, h('tr', {}, ['Key', 'Label', 'API model id', 'Price / image (1K)', 'Price / image (2K)', 'Max ref images', 'Negative prompt'].map((t) => h('th', {}, t)))),
        tbody)),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'Reference template'),
      template,
      h('span', { class: 'field-note' }, 'How @Image chips compile into prompt text; {n} is the image number. Default: image {n}')),
    h('div', { class: 'row' }, saveBtn, button('Discard changes', render, { variant: 'ghost' })));

  render();
  return el;
}
