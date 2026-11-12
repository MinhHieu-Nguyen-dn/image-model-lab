/**
 * Results section: run history (left) and the selected run (inputs + result card grid).
 * Cards are keyed by model and only re-rendered when their data changes, so polling
 * does not reset open <details> or reload images.
 */
import { h, clear, emptyState, loadingState, statusBadge, button } from './dom-helpers.js';
import { state } from './app-state.js';
import { formatDateTime, formatElapsed } from './format-helpers.js';
import { renderResultCard } from './result-card.js';
import { renderRunHistory, renderRunInputs } from './run-history-list.js';

// One shared ticker updates every running card's elapsed timer.
setInterval(() => {
  document.querySelectorAll('.elapsed[data-since]').forEach((el) => {
    el.textContent = formatElapsed(Number(el.dataset.since));
  });
}, 200);

export function createRunResultsView({ onRerun }) {
  const historyList = h('ul', { class: 'run-history' });
  const detail = h('div', { class: 'run-detail' });
  const el = h('section', { class: 'results-section', 'aria-label': 'Results' },
    h('h3', { class: 'section-title' }, 'Results'),
    h('div', { class: 'results-layout' },
      h('aside', { class: 'run-history-wrap' }, h('h4', {}, 'Run history'), historyList),
      detail));

  let shownRunId = null;
  let headerHost = null;
  let grid = null;
  let cards = new Map(); // modelKey -> { json, el }

  function selectRun(runId) {
    state.selectedRunId = runId;
    render();
  }

  function renderHeader(run) {
    clear(headerHost).append(
      h('div', {},
        h('h4', {}, `Run · ${formatDateTime(run.createdAt)}`),
        h('span', { class: 'muted small' }, `${(run.results ?? []).length} model(s)`)),
      h('div', { class: 'row' },
        statusBadge(run.status === 'done' ? 'done' : 'running'),
        button('Re-run with these inputs', () => onRerun(run), { title: 'Load this run\'s inputs back into the editor' })));
  }

  function renderCards(run) {
    const results = run.results ?? [];
    if (!results.length) {
      cards = new Map();
      clear(grid).append(emptyState('No model results in this run.'));
      return;
    }
    grid.querySelector(':scope > .empty-state')?.remove();
    const next = new Map();
    results.forEach((result, index) => {
      const key = result.modelKey ?? String(index);
      const json = JSON.stringify(result);
      const existing = cards.get(key);
      const cardEl = existing && existing.json === json ? existing.el : renderResultCard(result, run);
      if (existing && existing.el !== cardEl) existing.el.replaceWith(cardEl);
      next.set(key, { json, el: cardEl });
    });
    for (const [key, entry] of cards) if (!next.has(key)) entry.el.remove();
    cards = next;
    // Re-append in result order (moves existing nodes; no re-render).
    for (const { el: cardEl } of cards.values()) grid.append(cardEl);
  }

  function render() {
    renderRunHistory(historyList, state.runs, state.selectedRunId, selectRun);
    const run = state.runs.find((r) => r.id === state.selectedRunId);
    if (!run) {
      shownRunId = null;
      cards = new Map();
      clear(detail).append(state.runsLoading
        ? loadingState('Loading runs…')
        : emptyState('No run selected', 'Press Run to generate with the selected models; results appear here side by side.'));
      return;
    }
    if (run.id !== shownRunId) {
      shownRunId = run.id;
      cards = new Map();
      headerHost = h('header', { class: 'run-header row between' });
      grid = h('div', { class: 'card-grid' });
      clear(detail).append(headerHost, renderRunInputs(run), grid);
    }
    renderHeader(run);
    renderCards(run);
  }

  return { el, render };
}
