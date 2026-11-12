/**
 * Run history list (newest first) and the stored-inputs summary of a selected run.
 */
import { h, clear, statusBadge } from './dom-helpers.js';
import { formatDateTime, formatBytes, truncate } from './format-helpers.js';

function countLabel(run) {
  const results = run.results ?? [];
  const count = (s) => results.filter((r) => r.status === s).length;
  return [
    count('ok') && `${count('ok')} ok`,
    count('error') && `${count('error')} error`,
    count('skipped') && `${count('skipped')} skipped`,
  ].filter(Boolean).join(' · ') || `${results.length} models`;
}

export function renderRunHistory(listEl, runs, selectedId, onSelect) {
  clear(listEl);
  if (!runs.length) {
    listEl.append(h('li', { class: 'muted small' }, 'No runs yet.'));
    return;
  }
  for (const run of runs) {
    listEl.append(h('li', {},
      h('button', {
        type: 'button',
        class: `run-history-item${run.id === selectedId ? ' active' : ''}`,
        'aria-current': run.id === selectedId ? 'true' : null,
        onClick: () => onSelect(run.id),
      },
      h('span', { class: 'row between' },
        h('span', { class: 'small' }, formatDateTime(run.createdAt)),
        run.status === 'done' ? h('span', { class: 'small muted' }, countLabel(run)) : statusBadge('running')),
      h('span', { class: 'muted small run-snippet' },
        truncate(run.inputs?.compiledText ?? run.inputs?.prompt ?? '', 70) || '(empty prompt)'))));
  }
}

/** Collapsible summary of the inputs snapshot stored with a run. */
export function renderRunInputs(run) {
  const inputs = run.inputs ?? {};
  const refs = Array.isArray(inputs.refs) ? inputs.refs : [];
  const rows = [
    ['Size', inputs.size],
    ['n', inputs.n],
    ['Seed', inputs.seed ?? 'random'],
    ['Prompt extend', inputs.promptExtend ? 'on' : 'off'],
    ['Negative prompt', inputs.negativePrompt || '—'],
  ];
  return h('details', { class: 'run-inputs' },
    h('summary', {}, 'Stored inputs'),
    h('div', { class: 'stack' },
      h('div', {}, h('span', { class: 'field-label' }, 'Compiled prompt text'),
        h('pre', { class: 'text-block' }, inputs.compiledText ?? inputs.prompt ?? '')),
      h('dl', { class: 'metrics' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v ?? '—'))])),
      refs.length
        ? h('ol', { class: 'compiled-ref-order' }, refs.map((ref, i) => h('li', {},
          ref.url ? h('img', { src: ref.url, alt: '' }) : null,
          h('span', {}, `#${i + 1} ${ref.filename ?? ref.id}`),
          ref.bytes ? h('small', { class: 'muted' }, ` ${formatBytes(ref.bytes)}`) : null)))
        : h('p', { class: 'muted small' }, 'No reference images.')));
}
