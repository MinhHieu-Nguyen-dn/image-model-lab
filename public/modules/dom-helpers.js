/**
 * Tiny DOM helpers shared by every view module (no framework, no build step).
 */

/** Keys assigned as DOM properties instead of attributes. */
const PROP_KEYS = new Set([
  'value', 'checked', 'disabled', 'selected', 'hidden', 'textContent',
  'draggable', 'open', 'multiple', 'contentEditable',
]);

/**
 * Create an element.
 * Props: `class`, `dataset` (object), `style` (object), `on<Event>` handlers,
 * DOM properties listed in PROP_KEYS; anything else becomes an attribute.
 * `null`/`undefined`/`false` props and children are skipped.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (PROP_KEYS.has(key)) el[key] = value;
    else if (value !== false) el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Remove all children and return the element for chaining. */
export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Centered placeholder used for "nothing here yet" and loading states. */
export function emptyState(title, hint, action) {
  return h('div', { class: 'empty-state' },
    h('p', { class: 'empty-title' }, title),
    hint ? h('p', { class: 'muted' }, hint) : null,
    action ?? null);
}

/** Loading placeholder with spinner. */
export function loadingState(text = 'Loading…') {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'muted' }, text));
}

const STATUS_LABELS = {
  pending: 'Pending', running: 'Running', ok: 'OK', error: 'Error',
  skipped: 'Skipped', done: 'Done',
};

/** Colored pill describing a run / model-result status. */
export function statusBadge(status, label) {
  return h('span', { class: `badge status-${status}` }, label ?? STATUS_LABELS[status] ?? status);
}

/** Standard button factory. `variant` is one of '', 'primary', 'danger', 'ghost'. */
export function button(text, onClick, { variant = '', title, type = 'button', disabled } = {}) {
  return h('button', { type, class: `btn ${variant}`.trim(), title, disabled, onClick }, text);
}
