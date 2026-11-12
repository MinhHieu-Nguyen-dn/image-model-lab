/**
 * Modal dialogs built on native <dialog>: generic modal, text prompt, confirm, image lightbox.
 */
import { h, button } from './dom-helpers.js';

/** Open a modal with a title and arbitrary content. Closes on ×, Esc, or backdrop click. */
export function openModal({ title, content, wide = false, onClose }) {
  const dialog = h('dialog', { class: `modal${wide ? ' modal-wide' : ''}` });
  const close = () => { if (dialog.open) dialog.close(); };
  dialog.append(h('div', { class: 'modal-inner' },
    h('header', { class: 'modal-head' },
      h('h3', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: close }, '×')),
    h('div', { class: 'modal-body' }, content)));
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); });
  // The dialog element itself has no padding, so a click whose target is the dialog is a backdrop click.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

/** Ask for a single non-empty line of text. Resolves to the trimmed value or null if cancelled. */
export function promptText({ title, label, initial = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { type: 'text', value: initial, maxlength: 200, required: true });
    const form = h('form', {
      class: 'stack',
      onSubmit: (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) { input.focus(); return; }
        result = value;
        modal.close();
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
    h('div', { class: 'row end' },
      button('Cancel', () => modal.close()),
      button(confirmLabel, null, { variant: 'primary', type: 'submit' })));
    const modal = openModal({ title, content: form, onClose: () => resolve(result) });
    input.select();
  });
}

/** Yes/no confirmation. Resolves true only when confirmed. */
export function confirmAction({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const confirmBtn = button(confirmLabel, () => { result = true; modal.close(); }, { variant: danger ? 'danger' : 'primary' });
    const content = h('div', { class: 'stack' },
      h('p', {}, message),
      h('div', { class: 'row end' }, button('Cancel', () => modal.close()), confirmBtn));
    const modal = openModal({ title, content, onClose: () => resolve(result) });
    confirmBtn.focus();
  });
}

/** Full-size image viewer with a download link. */
export function openLightbox({ url, title, caption }) {
  const filename = url.split('/').pop() || 'image.png';
  openModal({
    title: title ?? 'Image',
    wide: true,
    content: h('figure', { class: 'lightbox' },
      h('img', { src: url, alt: title ?? 'Generated image' }),
      h('figcaption', { class: 'row between' },
        h('span', { class: 'muted' }, caption ?? ''),
        h('a', { class: 'btn', href: url, download: filename }, 'Download'))),
  });
}
