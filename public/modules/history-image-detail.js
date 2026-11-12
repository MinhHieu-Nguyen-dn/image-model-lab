/**
 * Image detail dialog for the History view: the image, where it came from, a like/dislike
 * toggle and the same result information the run card shows (latency, HTTP status, request id,
 * sizes, seed, rewritten prompt, cost, raw usage and request payload).
 * The full result is fetched from the run because history list items are deliberately light.
 */
import { h, clear, emptyState, loadingState, statusBadge } from './dom-helpers.js';
import { api, enc } from './api-client.js';
import { openModal, openLightbox } from './modal-dialogs.js';
import { formatBytes, formatDateTime } from './format-helpers.js';
import { renderRatingButtons } from './image-rating-buttons.js';
import { renderResultDetails } from './result-card.js';
import { recordRating } from './run-controller.js';

function sourceRows(item, result, image) {
  const dims = image.width && image.height ? `${image.width}×${image.height}` : null;
  const rows = [
    ['Project', item.projectName],
    ['Task', item.taskName],
    ['Run', formatDateTime(item.createdAt)],
    ['Image', `${item.imageIndex + 1} of ${result.images.length}${dims ? ` · ${dims}` : ''}${image.bytes ? ` · ${formatBytes(image.bytes)}` : ''}`],
  ];
  return h('dl', { class: 'metrics' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function renderDetail(item, result, image, onChanged) {
  const title = `${item.modelLabel} · image ${item.imageIndex + 1}`;
  return h('div', { class: 'image-detail' },
    h('button', {
      type: 'button', class: 'image-button image-detail-figure', title: 'Click to enlarge',
      onClick: () => openLightbox({ url: image.url, title, caption: '' }),
    }, h('img', { src: image.url, alt: title })),
    h('div', { class: 'image-detail-info stack' },
      h('div', { class: 'row between' },
        h('div', { class: 'result-title' },
          h('h4', {}, result.label || result.modelKey),
          h('code', { class: 'muted small' }, result.apiModel ?? '')),
        statusBadge(result.status)),
      h('div', { class: 'row' },
        h('span', { class: 'field-label' }, 'Rating'),
        renderRatingButtons({
          runId: item.runId, modelKey: item.modelKey, index: item.imageIndex, image,
          onRated: (rating) => {
            recordRating(item.runId, item.modelKey, item.imageIndex, rating);
            onChanged?.();
          },
        }),
        h('a', { class: 'small', href: image.url, download: image.url.split('/').pop() || 'image.png' }, 'Download')),
      sourceRows(item, result, image),
      result.error ? h('p', { class: 'card-error', role: 'alert' }, result.error) : null,
      renderResultDetails(result)));
}

/** Open the detail dialog for one history item; `onChanged` runs after its rating changes. */
export function openImageDetail(item, onChanged) {
  const body = h('div', {}, loadingState('Loading details…'));
  openModal({ title: `${item.modelLabel} · image ${item.imageIndex + 1}`, content: body, wide: true });
  void (async () => {
    try {
      const run = await api.get(`/api/runs/${enc(item.runId)}`);
      const result = run.results?.find((r) => r.modelKey === item.modelKey);
      const image = result?.images?.[item.imageIndex];
      if (!result || !image) throw new Error('This image no longer exists.');
      clear(body).append(renderDetail(item, result, image, onChanged));
    } catch (err) {
      clear(body).append(emptyState('Could not load image details', err?.message ?? String(err)));
    }
  })();
}
