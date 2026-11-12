/**
 * History view: every generated image across all runs, filterable by project, model and
 * like/dislike. A counts table shows images, likes, dislikes and unrated per model; it honours
 * the project filter only, so the per-model counts stay visible while the grid is narrowed.
 * Clicking an image opens its detail dialog.
 */
import { h, clear, emptyState, loadingState } from './dom-helpers.js';
import { api } from './api-client.js';
import { reportError } from './toast-notifications.js';
import { openImageDetail } from './history-image-detail.js';

/** Filters survive leaving and re-opening the view. */
const filters = { projectId: '', modelKey: '', rating: '' };

const GLYPH = { like: '👍', dislike: '👎' };
const RATING_FILTERS = [['', 'All'], ['like', '👍 Liked'], ['dislike', '👎 Disliked'], ['unrated', 'Unrated']];

export function mountHistoryView(main) {
  let disposed = false;
  let requestId = 0;
  let data = null;

  const filterBar = h('div', { class: 'history-filters' });
  const summaryHost = h('section', { class: 'panel stack', hidden: true });
  const gridHost = h('div', {}, loadingState('Loading images…'));
  main.append(
    h('header', { class: 'project-header' }, h('h1', {}, 'History')),
    filterBar, summaryHost, gridHost);

  function setFilters(patch) {
    Object.assign(filters, patch);
    void load();
  }

  async function load() {
    const id = ++requestId;
    const query = new URLSearchParams();
    if (filters.projectId) query.set('projectId', filters.projectId);
    if (filters.modelKey) query.set('model', filters.modelKey);
    if (filters.rating) query.set('rating', filters.rating);
    try {
      const res = await api.get(`/api/history?${query}`);
      if (disposed || id !== requestId) return;
      // A remembered project or model may have been deleted or may not exist in this project.
      if (filters.projectId && !res.projects.some((p) => p.id === filters.projectId)) return setFilters({ projectId: '' });
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

  function renderFilters() {
    clear(filterBar).append(
      select('Project', filters.projectId, [['', 'All projects'], ...data.projects.map((p) => [p.id, p.name])],
        (projectId) => setFilters({ projectId })),
      select('Model', filters.modelKey, [['', 'All models'], ...data.models.map((m) => [m.modelKey, m.label])],
        (modelKey) => setFilters({ modelKey })),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Rating'),
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter by rating' },
          RATING_FILTERS.map(([value, text]) => h('button', {
            type: 'button', class: `segment${filters.rating === value ? ' active' : ''}`,
            'aria-pressed': String(filters.rating === value), onClick: () => setFilters({ rating: value }),
          }, text)))));
  }

  /** A count that filters the grid to that model (and rating) when clicked. */
  function countCell(model, rating, value) {
    const active = filters.modelKey === model.modelKey && filters.rating === rating;
    return h('td', { class: 'num' }, h('button', {
      type: 'button', class: `count-link${active ? ' active' : ''}`, disabled: value === 0,
      title: `Show ${rating ? `${rating === 'unrated' ? 'unrated' : `${rating}d`} ` : ''}images from ${model.label}`,
      onClick: () => setFilters({ modelKey: model.modelKey, rating }),
    }, String(value)));
  }

  function renderSummary() {
    summaryHost.hidden = !data.models.length;
    if (!data.models.length) return;
    const total = data.models.reduce((t, m) => ({
      images: t.images + m.images, likes: t.likes + m.likes, dislikes: t.dislikes + m.dislikes, unrated: t.unrated + m.unrated,
    }), { images: 0, likes: 0, dislikes: 0, unrated: 0 });
    const scope = filters.projectId ? data.projects.find((p) => p.id === filters.projectId)?.name : 'all projects';
    clear(summaryHost).append(
      h('h3', { class: 'section-title' }, `Counts by model · ${scope}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'catalog-table history-counts' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Model'), h('th', { class: 'num' }, 'Images'),
          h('th', { class: 'num' }, `${GLYPH.like} Likes`), h('th', { class: 'num' }, `${GLYPH.dislike} Dislikes`),
          h('th', { class: 'num' }, 'Unrated'))),
        h('tbody', {},
          data.models.map((m) => h('tr', { class: filters.modelKey === m.modelKey ? 'active' : '' },
            h('td', {}, h('button', {
              type: 'button', class: `count-link model-link${filters.modelKey === m.modelKey && !filters.rating ? ' active' : ''}`,
              onClick: () => setFilters({ modelKey: m.modelKey, rating: '' }),
            }, m.label)),
            countCell(m, '', m.images), countCell(m, 'like', m.likes), countCell(m, 'dislike', m.dislikes), countCell(m, 'unrated', m.unrated))),
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

  void load();
  return () => { disposed = true; };
}
