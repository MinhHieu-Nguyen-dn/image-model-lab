/**
 * Floating "@" picker listing reference images (thumbnail + "Image N").
 * Keyboard: ArrowUp/ArrowDown move, Enter/Tab select. Mouse: hover + click.
 * Escape is handled by the editor (it also suppresses re-opening for that "@").
 */
import { h, clear } from './dom-helpers.js';

export function createMentionPicker({ onSelect }) {
  const el = h('ul', { class: 'mention-picker', role: 'listbox', 'aria-label': 'Reference images' });
  let items = [];
  let active = 0;
  let isOpen = false;

  const closeOnViewportChange = () => close();

  function setActive(index) {
    active = index;
    [...el.children].forEach((li, i) => {
      li.classList.toggle('active', i === index);
      li.setAttribute('aria-selected', String(i === index));
    });
    el.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    clear(el);
    if (!items.length) {
      el.append(h('li', { class: 'mention-empty' }, 'No matching reference images. Upload images first.'));
      return;
    }
    items.forEach((item, i) => el.append(h('li', {
      class: 'mention-item',
      role: 'option',
      // mousedown (not click) + preventDefault keeps focus and caret inside the editor.
      onMousedown: (e) => { e.preventDefault(); onSelect(item); },
      onMousemove: () => { if (active !== i) setActive(i); },
    },
    h('img', { src: item.url, alt: '' }),
    h('span', { class: 'mention-label' }, `Image ${item.n}`),
    h('small', { class: 'muted' }, item.filename ?? ''))));
    setActive(Math.min(active, items.length - 1));
  }

  /** Position below the caret, flipping above when there is no room. */
  function position(rect) {
    el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
    const below = rect.bottom + 6;
    const top = below + el.offsetHeight > window.innerHeight ? rect.top - el.offsetHeight - 6 : below;
    el.style.top = `${Math.max(8, top)}px`;
  }

  function open(rect, nextItems) {
    const previousId = items[active]?.id;
    items = nextItems;
    const keep = items.findIndex((x) => x.id === previousId);
    active = keep >= 0 ? keep : 0;
    if (!isOpen) {
      document.body.append(el);
      isOpen = true;
      window.addEventListener('scroll', closeOnViewportChange, true);
      window.addEventListener('resize', closeOnViewportChange);
    }
    render();
    position(rect);
  }

  function close() {
    if (!isOpen) return;
    el.remove();
    isOpen = false;
    window.removeEventListener('scroll', closeOnViewportChange, true);
    window.removeEventListener('resize', closeOnViewportChange);
  }

  /** Returns true when the key was consumed by the picker. */
  function handleKey(e) {
    if (!isOpen || !items.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + delta + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      onSelect(items[active]);
      return true;
    }
    return false;
  }

  return { open, close, handleKey, isOpen: () => isOpen };
}
