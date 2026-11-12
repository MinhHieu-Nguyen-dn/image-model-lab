/**
 * Per-model result card: images (lightbox + download), status, latency, HTTP status,
 * request id, actual size, file size, image count, seed, rewritten prompt, est. cost,
 * raw usage JSON, error text, omitted params and the compiled payload.
 */
import { h, statusBadge } from './dom-helpers.js';
import { formatMs, formatBytes, formatCost, formatElapsed, toEpochMs } from './format-helpers.js';
import { openLightbox } from './modal-dialogs.js';
import { jsonDetails } from './compile-request-view.js';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

function renderImages(result) {
  const images = Array.isArray(result.images) ? result.images : [];
  if (!images.length) return null;
  return h('div', { class: `card-images count-${Math.min(images.length, 4)}` }, images.map((img, i) => {
    const dims = img.width && img.height ? `${img.width}×${img.height}` : '';
    const caption = [dims, img.bytes ? formatBytes(img.bytes) : ''].filter(Boolean).join(' · ');
    const title = `${result.label || result.modelKey} · image ${i + 1}`;
    return h('figure', { class: 'card-image' },
      h('button', { type: 'button', class: 'image-button', title: 'Click to enlarge', onClick: () => openLightbox({ url: img.url, title, caption }) },
        h('img', { src: img.url, alt: title, loading: 'lazy' })),
      h('figcaption', { class: 'row between small' },
        h('span', { class: 'muted' }, caption),
        h('a', { href: img.url, download: img.url.split('/').pop() || 'image.png' }, 'Download')));
  }));
}

function renderMetrics(result) {
  const images = Array.isArray(result.images) ? result.images : [];
  const sizes = [...new Set(images.filter((i) => i.width && i.height).map((i) => `${i.width}×${i.height}`))].join(', ');
  const totalBytes = images.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
  const rows = [
    ['Latency', formatMs(result.latencyMs)],
    ['Download', result.downloadMs !== undefined && result.downloadMs !== null ? formatMs(result.downloadMs) : null],
    ['HTTP status', result.httpStatus],
    ['Request ID', result.requestId],
    ['Actual size', sizes || null],
    ['File size', images.length ? `${formatBytes(totalBytes)}${images.length > 1 ? ' total' : ''}` : null],
    ['Images', result.imageCount ?? images.length],
    ['Seed', result.seed],
    ['Rewrite status', result.rewriteStatus],
    ['Est. cost', result.estCost !== undefined && result.estCost !== null ? formatCost(result.estCost) : null],
  ];
  return h('dl', { class: 'metrics' }, rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: k === 'Request ID' ? 'mono' : '' }, String(v))]));
}

/** Render one card. `run` supplies createdAt for the running elapsed timer. */
export function renderResultCard(result, run) {
  const active = ACTIVE_STATUSES.has(result.status);
  const since = toEpochMs(run.createdAt);
  const omitted = result.omittedParams ?? [];
  return h('article', { class: `result-card result-${result.status}` },
    h('header', { class: 'result-card-head' },
      h('div', { class: 'result-title' },
        h('h4', {}, result.label || result.modelKey),
        h('code', { class: 'muted small' }, result.apiModel ?? '')),
      statusBadge(result.status)),
    active
      ? h('div', { class: 'card-running' },
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('span', {}, result.status === 'pending' ? 'Queued' : 'Generating'),
        h('span', { class: 'elapsed mono', dataset: { since: String(since) } }, formatElapsed(since)))
      : null,
    result.error ? h('p', { class: 'card-error', role: 'alert' }, result.error) : null,
    renderImages(result),
    active ? null : renderMetrics(result),
    omitted.length ? h('p', { class: 'field-note' }, `Omitted params (not supported by this model): ${omitted.join(', ')}`) : null,
    result.rewrittenPrompt
      ? h('div', { class: 'rewritten' },
        h('span', { class: 'field-label' }, `Rewritten prompt${result.rewriteStatus ? ` (${result.rewriteStatus})` : ''}`),
        h('p', { class: 'text-block' }, result.rewrittenPrompt))
      : null,
    jsonDetails('Raw usage JSON', result.usage),
    jsonDetails('Compiled request payload', result.payload));
}
