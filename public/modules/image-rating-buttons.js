/**
 * Like / dislike toggle for one generated image. Clicking the active button clears the rating.
 * The rating is saved on the server first; only then is `image.rating` updated, so the
 * buttons never show a state that was not persisted.
 */
import { h } from './dom-helpers.js';
import { api, enc } from './api-client.js';
import { reportError } from './toast-notifications.js';

const KINDS = [
  { rating: 'like', glyph: '👍', label: 'Like' },
  { rating: 'dislike', glyph: '👎', label: 'Dislike' },
];

/**
 * @param {{runId: string, modelKey: string, index: number, image: {rating?: string}, onRated?: (rating: string|null) => void}} opts
 *   `image` is mutated on success (`rating` set or removed); `onRated` runs afterwards.
 */
export function renderRatingButtons({ runId, modelKey, index, image, onRated }) {
  const buttons = new Map();
  const group = h('span', { class: 'rating-buttons', role: 'group', 'aria-label': 'Rate this image' });

  function sync() {
    for (const [kind, btn] of buttons) {
      const on = image.rating === kind;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  async function choose(kind) {
    const next = image.rating === kind ? null : kind;
    for (const btn of buttons.values()) btn.disabled = true;
    try {
      await api.put(`/api/runs/${enc(runId)}/results/${enc(modelKey)}/images/${index}/rating`, { rating: next });
      if (next) image.rating = next;
      else delete image.rating;
      sync();
      onRated?.(next);
    } catch (err) {
      reportError(err, 'Could not save the rating');
    } finally {
      for (const btn of buttons.values()) btn.disabled = false;
    }
  }

  for (const { rating, glyph, label } of KINDS) {
    const btn = h('button', {
      type: 'button', class: `rating-btn rating-${rating}`, title: label, 'aria-label': label,
      onClick: () => void choose(rating),
    }, glyph);
    buttons.set(rating, btn);
    group.append(btn);
  }
  sync();
  return group;
}
