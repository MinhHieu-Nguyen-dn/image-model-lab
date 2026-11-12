/**
 * History view: every generated image across all runs, filterable by project(s), task(s), model,
 * prompt extend (on/off) and like/dislike. Project and task are multi-select. A counts table shows images, likes, dislikes and
 * unrated per model, each model expandable into prompt-extend on/off rows; it honours the project
 * and task filters only, so the counts stay visible while the grid is narrowed.
 * Clicking an image opens its detail dialog.
 */
import { h, clear, emptyState, loadingState } from './dom-helpers.js';
import { api } from './api-client.js';
import { reportError } from './toast-notifications.js';
import { openImageDetail } from './history-image-detail.js';

/** Filters survive leaving and re-opening the view. */
const filters = { projectIds: [], taskIds: [], promptExtend: '', modelKey: '', rating: '' };

const GLYPH = { like: '👍', dislike: '👎' };
/** Models whose prompt-extend on/off rows are expanded; survives re-renders and re-opening. */
const expandedModels = new Set();
const EXTEND_FILTERS = [['', 'All'], ['true', 'On'], ['false', 'Off']];
const RATING_FILTERS = [['', 'All'], ['like', '👍 Liked'], ['dislike', '👎 Disliked'], ['unrated', 'Unrated']];

export function mountHistoryView(main) {
  let disposed = false;
  let requestId = 0;
  let data = null;
  /** Title of the multi-select menu currently open, kept across re-renders. */
  let openMenu = '';

  const filterBar = h('div', { class: 'history-filters' });
  const summaryHost = h('section', { class: 'panel stack', hidden: true });
  const gridHost = h('div', {}, loadingState('Loading images…'));
  main.append(
    h('header', { class: 'project-header' }, h('h1', {}, 'History')),
    filterBar, summaryHost, gridHost);

  function setFilters(patch) {
    Object.assign(filters, patch);
    if (data) renderFilters(); // show the new selection at once, so quick successive clicks build on it
    void load();
  }

  async function load() {
    const id = ++requestId;
    const query = new URLSearchParams();
    filters.projectIds.forEach((pid) => query.append('projectId', pid));
    filters.taskIds.forEach((tid) => query.append('taskId', tid));
    if (filters.promptExtend) query.set('promptExtend', filters.promptExtend);
    if (filters.modelKey) query.set('model', filters.modelKey);
    if (filters.rating) query.set('rating', filters.rating);
    try {
      const res = await api.get(`/api/history?${query}`);
      if (disposed || id !== requestId) return;
      // Remembered projects, tasks or a model may have been deleted or may not exist in this scope.
      const projectIds = filters.projectIds.filter((pid) => res.projects.some((p) => p.id === pid));
      const taskIds = filters.taskIds.filter((tid) => res.tasks.some((t) => t.id === tid));
      if (projectIds.length !== filters.projectIds.length || taskIds.length !== filters.taskIds.length) {
        return setFilters({ projectIds, taskIds });
      }
      if (filters.modelKey && !res.models.some((m) => m.modelKey === filters.modelKey)) return setFilters({ modelKey: '' });
      data = res;
      render();
    } catch (err) {
      if (disposed || id !== requestId) return;
      reportError(err, 'Could not load image history');
      if (!data) clear(gridHost).append(emptyState('Could not load image history', err?.message ?? ''));
    }
  }

  function select(label, value, options, onChange) {
    return h('label', { class: 'field history-filter' },
      h('span', { class: 'field-label' }, label),
      h('select', { onChange: (e) => onChange(e.target.value) },
        options.map(([val, text]) => h('option', { value: val, selected: val === value }, text))));
  }

  /**
   * Filter controls are reused while their inputs are unchanged: replacing a control between a
   * mouse-down and mouse-up would swallow the click, which happens when a load finishes mid-click.
   */
  const controls = new Map();
  function cached(key, signature, build) {
    const sig = JSON.stringify(signature);
    const hit = controls.get(key);
    if (hit?.sig === sig) return hit.el;
    const el = build();
    controls.set(key, { sig, el });
    return el;
  }

  /**
   * Dropdown with a checkbox per option; `selected` is an array of option values and an empty
   * selection means "all". `pairs` are [value, label].
   */
  function multiSelect(label, allLabel, selected, pairs, onChange) {
    const open = openMenu === label;
    return cached(label, [selected, pairs, open], () => buildMultiSelect(label, allLabel, selected, pairs, onChange, open));
  }

  function buildMultiSelect(label, allLabel, selected, pairs, onChange, open) {
    const chosen = pairs.filter(([value]) => selected.includes(value));
    const summary = !chosen.length ? allLabel : chosen.length === 1 ? chosen[0][1] : `${chosen.length} selected`;
    const toggle = (value, on) => onChange(on ? [...selected, value] : selected.filter((v) => v !== value));
    const trigger = h('button', {
      type: 'button', class: 'multi-trigger', 'aria-haspopup': 'true', 'aria-expanded': String(open),
      onClick: () => { openMenu = open ? '' : label; renderFilters(); },
    }, h('span', { class: 'multi-summary' }, summary), h('span', { 'aria-hidden': 'true' }, '▾'));
    const menu = open ? h('div', { class: 'multi-menu', role: 'group', 'aria-label': label },
      h('button', {
        type: 'button', class: 'multi-clear', disabled: !selected.length, onClick: () => onChange([]),
      }, `Clear (${allLabel})`),
      pairs.length ? pairs.map(([value, text]) => h('label', { class: 'multi-option' },
        h('input', { type: 'checkbox', checked: selected.includes(value), onChange: (e) => toggle(value, e.target.checked) }),
        h('span', {}, text))) : h('p', { class: 'muted small' }, 'Nothing to choose yet.')) : null;
    return h('div', { class: 'field history-filter multi-select', dataset: { menu: label } },
      h('span', { class: 'field-label' }, label), trigger, menu);
  }

  /** Segmented button group; `pairs` are [value, label]. */
  function segmented(label, current, pairs, onPick) {
    return h('div', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      h('div', { class: 'segmented', role: 'group', 'aria-label': `Filter by ${label.toLowerCase()}` },
        pairs.map(([value, text]) => h('button', {
          type: 'button', class: `segment${current === value ? ' active' : ''}`,
          'aria-pressed': String(current === value), onClick: () => onPick(value),
        }, text))));
  }

  function renderFilters() {
    // With exactly one project selected its name is redundant in the task list.
    const taskOptions = data.tasks.map((t) => [t.id, filters.projectIds.length === 1 ? t.name : `${t.projectName} › ${t.name}`]);
    clear(filterBar).append(
      multiSelect('Project', 'All projects', filters.projectIds, data.projects.map((p) => [p.id, p.name]),
        // A task belongs to one project, so tasks of a project that is no longer selected are dropped.
        (projectIds) => setFilters({
          projectIds,
          taskIds: !projectIds.length ? filters.taskIds
            : filters.taskIds.filter((tid) => projectIds.includes(data.tasks.find((t) => t.id === tid)?.projectId)),
        })),
      multiSelect('Task', 'All tasks', filters.taskIds, taskOptions, (taskIds) => setFilters({ taskIds })),
      select('Model', filters.modelKey, [['', 'All models'], ...data.models.map((m) => [m.modelKey, m.label])],
        (modelKey) => setFilters({ modelKey })),
      segmented('Prompt extend', filters.promptExtend, EXTEND_FILTERS, (promptExtend) => setFilters({ promptExtend })),
      segmented('Rating', filters.rating, RATING_FILTERS, (rating) => setFilters({ rating })));
  }

  /** A count that filters the grid to that model, prompt-extend setting ('' = both) and rating. */
  function countCell(model, rating, value, extend = '') {
    const active = filters.modelKey === model.modelKey && filters.rating === rating && filters.promptExtend === extend;
    const what = [rating ? (rating === 'unrated' ? 'unrated' : `${rating}d`) : '', extend ? `prompt extend ${extend === 'true' ? 'on' : 'off'}` : '']
      .filter(Boolean).join(', ');
    return h('td', { class: 'num' }, h('button', {
      type: 'button', class: `count-link${active ? ' active' : ''}`, disabled: value === 0,
      title: `Show ${what ? `${what} ` : ''}images from ${model.label}`,
      onClick: () => setFilters({ modelKey: model.modelKey, rating, promptExtend: extend }),
    }, String(value)));
  }

  /** A model row, followed by its prompt-extend on/off rows when expanded. */
  function modelRows(m) {
    const open = expandedModels.has(m.modelKey);
    const toggle = h('button', {
      type: 'button', class: 'expand-toggle', 'aria-expanded': String(open),
      'aria-label': `${open ? 'Hide' : 'Show'} prompt extend breakdown for ${m.label}`,
      onClick: () => { if (open) expandedModels.delete(m.modelKey); else expandedModels.add(m.modelKey); renderSummary(); },
    }, open ? '▾' : '▸');
    const rows = [h('tr', { class: filters.modelKey === m.modelKey ? 'active' : '' },
      h('td', { class: 'model-cell' }, toggle, h('button', {
        type: 'button', class: `count-link model-link${filters.modelKey === m.modelKey && !filters.rating && !filters.promptExtend ? ' active' : ''}`,
        onClick: () => setFilters({ modelKey: m.modelKey, rating: '', promptExtend: '' }),
      }, m.label)),
      countCell(m, '', m.images), countCell(m, 'like', m.likes), countCell(m, 'dislike', m.dislikes), countCell(m, 'unrated', m.unrated))];
    if (open) {
      for (const [extend, label, c] of [['true', 'Prompt extend on', m.promptExtend.on], ['false', 'Prompt extend off', m.promptExtend.off]]) {
        rows.push(h('tr', { class: 'sub-row' },
          h('td', {}, label),
          countCell(m, '', c.images, extend), countCell(m, 'like', c.likes, extend),
          countCell(m, 'dislike', c.dislikes, extend), countCell(m, 'unrated', c.unrated, extend)));
      }
    }
    return rows;
  }

  function renderSummary() {
    summaryHost.hidden = !data.models.length;
    if (!data.models.length) return;
    const total = data.models.reduce((t, m) => ({
      images: t.images + m.images, likes: t.likes + m.likes, dislikes: t.dislikes + m.dislikes, unrated: t.unrated + m.unrated,
    }), { images: 0, likes: 0, dislikes: 0, unrated: 0 });
    const names = (ids, list, noun) => {
      const found = list.filter((item) => ids.includes(item.id)).map((item) => item.name);
      return found.length <= 2 ? found.join(', ') : `${found.length} ${noun}`;
    };
    const scope = filters.taskIds.length ? names(filters.taskIds, data.tasks, 'tasks')
      : filters.projectIds.length ? names(filters.projectIds, data.projects, 'projects') : 'all projects';
    clear(summaryHost).append(
      h('h3', { class: 'section-title' }, `Counts by model · ${scope}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'catalog-table history-counts' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Model'), h('th', { class: 'num' }, 'Images'),
          h('th', { class: 'num' }, `${GLYPH.like} Likes`), h('th', { class: 'num' }, `${GLYPH.dislike} Dislikes`),
          h('th', { class: 'num' }, 'Unrated'))),
        h('tbody', {},
          data.models.flatMap(modelRows),
          h('tr', { class: 'total-row' },
            h('td', {}, 'Total'), h('td', { class: 'num' }, String(total.images)), h('td', { class: 'num' }, String(total.likes)),
            h('td', { class: 'num' }, String(total.dislikes)), h('td', { class: 'num' }, String(total.unrated)))))));
  }

  function renderTile(item) {
    const { image } = item;
    const title = `${item.modelLabel} · image ${item.imageIndex + 1}`;
    return h('button', {
      type: 'button', class: 'history-tile', title: `${title} — ${item.projectName} › ${item.taskName}`,
      onClick: () => openImageDetail(item, () => void load()),
    },
    h('img', { src: image.url, alt: title, loading: 'lazy' }),
    image.rating ? h('span', { class: `history-tile-rating rating-${image.rating}`, 'aria-label': image.rating }, GLYPH[image.rating]) : null,
    h('span', { class: 'history-tile-caption' },
      h('strong', {}, item.modelLabel),
      h('span', { class: 'muted' }, `${item.projectName} › ${item.taskName}`)));
  }

  function renderGrid() {
    clear(gridHost);
    if (!data.images.length) {
      const any = data.models.length > 0;
      gridHost.append(emptyState(any ? 'No images match these filters' : 'No generated images yet',
        any ? 'Change the project, model or rating filter.' : 'Images from your runs appear here.'));
      return;
    }
    gridHost.append(
      h('p', { class: 'muted small' }, `${data.images.length} image${data.images.length === 1 ? '' : 's'}`),
      h('div', { class: 'history-grid' }, data.images.map(renderTile)));
  }

  function render() {
    renderFilters();
    renderSummary();
    renderGrid();
  }

  // Close an open multi-select menu on a click elsewhere or Escape.
  const closeMenu = (e) => {
    if (!openMenu || (e.type === 'keydown' && e.key !== 'Escape')) return;
    if (e.type === 'click' && e.target.closest?.('.multi-select')) return;
    openMenu = '';
    if (data) renderFilters();
  };
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', closeMenu);

  void load();
  return () => {
    disposed = true;
    document.removeEventListener('click', closeMenu);
    document.removeEventListener('keydown', closeMenu);
  };
}
