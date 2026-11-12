/**
 * Toast notifications: transient messages stacked in the corner.
 * Every fetch failure is surfaced through reportError so nothing fails silently.
 */
import { h } from './dom-helpers.js';

function container() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/** Show a toast. kind: 'info' | 'success' | 'error'. */
export function showToast(message, kind = 'info', timeoutMs = kind === 'error' ? 8000 : 3500) {
  const toast = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-text' }, message),
    h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onClick: () => toast.remove() }, '×'));
  container().append(toast);
  setTimeout(() => toast.remove(), timeoutMs);
}

/** Log and show an error with optional context prefix. */
export function reportError(err, context) {
  console.error(context ?? 'Error', err);
  const msg = err?.message ?? String(err);
  showToast(context ? `${context}: ${msg}` : msg, 'error');
}
