/**
 * Full-size image viewer for the images of one model result. Arrow buttons (or ←/→) move
 * between images, and the like/dislike buttons (or the L / K keys) rate the image on screen.
 * Keys are bound to the document while the viewer is open, so they keep working after a
 * click moved focus onto a button that then became disabled.
 */
import { h } from './dom-helpers.js';
import { openModal } from './modal-dialogs.js';
import { renderRatingButtons } from './image-rating-buttons.js';

/**
 * @typedef {{url: string, title: string, caption?: string, image: {rating?: string},
 *   runId: string, modelKey: string, index: number}} GalleryItem
 * @param {{items: GalleryItem[], index?: number, onRated?: (item: GalleryItem, rating: string|null) => void}} opts
 */
export function openImageGallery({ items, index = 0, onRated }) {
  if (!items.length) return;
  let current = Math.min(Math.max(index, 0), items.length - 1);
  const many = items.length > 1;

  const img = h('img', { alt: '' });
  const prev = h('button', { type: 'button', class: 'lightbox-nav lightbox-prev', 'aria-label': 'Previous image', title: 'Previous (←)', onClick: () => go(-1) }, '‹');
  const next = h('button', { type: 'button', class: 'lightbox-nav lightbox-next', 'aria-label': 'Next image', title: 'Next (→)', onClick: () => go(1) }, '›');
  const counter = h('span', { class: 'lightbox-counter' });
  const caption = h('span', { class: 'muted' });
  const ratingHost = h('span', { class: 'row' });
  const download = h('a', { class: 'btn' }, 'Download');
  let ratings = null;

  const hint = `${many ? '← → switch · ' : ''}L like · K dislike`;
  const content = h('figure', { class: 'lightbox' },
    h('div', { class: 'lightbox-stage' }, many ? prev : null, img, many ? next : null),
    h('figcaption', { class: 'lightbox-bar' },
      h('div', { class: 'row' }, many ? counter : null, caption),
      h('div', { class: 'row' }, ratingHost, download)),
    h('p', { class: 'muted small lightbox-hint' }, hint));

  const modal = openModal({ title: '', content, wide: true, onClose: () => document.removeEventListener('keydown', onKey, true) });
  const heading = modal.dialog.querySelector('.modal-head h3');

  function show() {
    const item = items[current];
    heading.textContent = item.title;
    img.src = item.url;
    img.alt = item.title;
    counter.textContent = `${current + 1} / ${items.length}`;
    caption.textContent = item.caption ?? '';
    download.href = item.url;
    download.download = item.url.split('/').pop() || 'image.png';
    prev.disabled = current === 0;
    next.disabled = current === items.length - 1;
    ratings = renderRatingButtons({
      runId: item.runId, modelKey: item.modelKey, index: item.index, image: item.image,
      onRated: (rating) => onRated?.(item, rating),
    });
    ratingHost.replaceChildren(ratings);
  }

  function go(step) {
    const target = current + step;
    if (target < 0 || target >= items.length) return;
    current = target;
    show();
  }

  function onKey(e) {
    if (!modal.dialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      if (many) go(key === 'ArrowLeft' ? -1 : 1);
    } else if ((key === 'l' || key === 'k') && !e.repeat) {
      e.preventDefault();
      void ratings?.rate(key === 'l' ? 'like' : 'dislike');
    }
  }

  document.addEventListener('keydown', onKey, true);
  show();
}
