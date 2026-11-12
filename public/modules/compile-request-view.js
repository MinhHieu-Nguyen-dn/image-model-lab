/**
 * "View request": POST /api/tasks/:tid/compile and show the per-model compiled payload
 * (image order, final text, omitted params, errors such as over-limit) plus raw JSON.
 */
import { h, statusBadge } from './dom-helpers.js';
import { api, enc } from './api-client.js';
import { catalogModel } from './app-state.js';
import { reportError, showToast } from './toast-notifications.js';
import { flushAutosave } from './task-autosave.js';
import { openModal } from './modal-dialogs.js';
import { openReferenceGallery } from './image-gallery-lightbox.js';
import { formatBytes } from './format-helpers.js';

/** Collapsible pretty-printed JSON block (null when there is nothing to show). */
export function jsonDetails(title, value, open = false) {
  if (value === undefined || value === null) return null;
  return h('details', { class: 'json-details', open },
    h('summary', {}, title),
    h('pre', { class: 'json' }, JSON.stringify(value, null, 2)));
}

function renderModelSection(key, compiled) {
  const label = catalogModel(key)?.label ?? key;
  const omitted = compiled.omittedParams ?? [];
  return h('section', { class: `compiled-model ${compiled.ok ? 'ok' : 'failed'}` },
    h('header', { class: 'row between' },
      h('div', {}, h('h4', {}, label), h('code', { class: 'muted small' }, compiled.apiModel ?? '')),
      statusBadge(compiled.ok ? 'ok' : 'error', compiled.ok ? 'Ready' : 'Will fail')),
    compiled.error ? h('p', { class: 'card-error' }, compiled.error) : null,
    omitted.length
      ? h('p', { class: 'field-note' }, `Omitted parameters (not supported by this model): ${omitted.join(', ')}`)
      : null,
    jsonDetails('Request payload (JSON)', compiled.payload, Boolean(compiled.ok)));
}

function renderCompiled(data, task) {
  const refsById = new Map((task.refs ?? []).map((r) => [r.id, r]));
  const refOrder = Array.isArray(data?.refOrder) ? data.refOrder : [];
  const perModel = Object.entries(data?.perModel ?? {});
  return h('div', { class: 'stack compiled-view' },
    h('section', {},
      h('h4', {}, 'Final prompt text'),
      h('pre', { class: 'text-block' }, data?.text ?? '')),
    h('section', {},
      h('h4', {}, 'Image order in content'),
      refOrder.length
        ? h('ol', { class: 'compiled-ref-order' }, refOrder.map((id, i) => {
          const ref = refsById.get(id);
          return h('li', {},
            ref ? h('img', { src: ref.url, alt: '', class: 'zoomable', title: 'Click to enlarge', onClick: () => openReferenceGallery(refOrder.map((rid) => refsById.get(rid)), i) }) : null,
            h('span', {}, `image ${i + 1}: ${ref?.filename ?? id}`),
            ref ? h('small', { class: 'muted' }, ` ${formatBytes(ref.bytes)}`) : null);
        }))
        : h('p', { class: 'muted' }, 'No reference images (text-to-image).'),
      h('p', { class: 'field-note' }, 'Images are sent first in this order, followed by exactly one text item.')),
    perModel.length
      ? perModel.map(([key, compiled]) => renderModelSection(key, compiled ?? {}))
      : h('p', { class: 'muted' }, 'No models selected.'));
}

export async function openCompileRequest(task) {
  if (!(task.models ?? []).length) {
    showToast('Select at least one model first.', 'error');
    return;
  }
  if ((await flushAutosave()) === false) return;
  try {
    const data = await api.post(`/api/tasks/${enc(task.id)}/compile`, { models: task.models });
    openModal({ title: 'Compiled request', wide: true, content: renderCompiled(data, task) });
  } catch (err) {
    reportError(err, 'Could not compile the request');
  }
}
