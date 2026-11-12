/**
 * Like / dislike toggle for one generated image. Clicking the active button clears the rating.
 * The rating is saved on the server first; only then is `image.rating` updated, so the
 * buttons never show a state that was not persisted.
 */
import { h } from './dom-helpers.js';
import { api, enc } from './api-client.js';
import { reportError } from './toast-notifications.js';

/**
 * Every live button group, so a rating saved from one place (result card, gallery, history
 * detail) updates the other groups showing the same image. WeakRefs let discarded cards go.
 */
const liveGroups = new Set();

function broadcast(source, change) {
  for (const ref of liveGroups) {
    const group = ref.deref();
    if (!group) liveGroups.delete(ref);
    else if (group !== source) group.applyRating(change);
  }
}

const KINDS = [
  { rating: 'like', glyph: '👍', label: 'Like' },
  { rating: 'dislike', glyph: '👎', label: 'Dislike' },
];

/**
 * @param {{runId: string, modelKey: string, index: number, image: {rating?: string}, onRated?: (rating: string|null) => void}} opts
 *   `image` is mutated on success (`rating` set or removed); `onRated` runs afterwards.
 *   The returned element also exposes `rate(kind)` (same as clicking that button) for keyboard shortcuts.
 */
export function renderRatingButtons({ runId, modelKey, index, image, onRated }) {
  const buttons = new Map();
  const group = h('span', { class: 'rating-buttons', role: 'group', 'aria-label': 'Rate this image' });
  let saving = false;

  function sync() {
    for (const [kind, btn] of buttons) {
      const on = image.rating === kind;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  async function choose(kind) {
    if (saving) return;
    saving = true;
    const next = image.rating === kind ? null : kind;
    for (const btn of buttons.values()) btn.disabled = true;
    try {
      await api.put(`/api/runs/${enc(runId)}/results/${enc(modelKey)}/images/${index}/rating`, { rating: next });
      if (next) image.rating = next;
      else delete image.rating;
      sync();
      broadcast(group, { runId, modelKey, index, rating: next });
      onRated?.(next);
    } catch (err) {
      reportError(err, 'Could not save the rating');
    } finally {
      saving = false;
      for (const btn of buttons.values()) btn.disabled = false;
    }
  }

  group.rate = (kind) => choose(kind);
  group.applyRating = (change) => {
    if (change.runId !== runId || change.modelKey !== modelKey || change.index !== index) return;
    if (change.rating) image.rating = change.rating;
    else delete image.rating;
    sync();
  };
  liveGroups.add(new WeakRef(group));

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
