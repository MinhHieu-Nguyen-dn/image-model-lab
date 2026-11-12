/**
 * Ordered reference images panel: upload (button / drag-drop / paste), numbered
 * thumbnails #1..#N, drag-to-reorder (PUT refs/order) and remove (DELETE).
 * The task object is mutated in place; callers get onRefsChanged / onRefRemoved.
 */
import { h, clear, button } from './dom-helpers.js';
import { api, enc, sortRefs } from './api-client.js';
import { reportError, showToast } from './toast-notifications.js';
import { confirmAction } from './modal-dialogs.js';
import { formatBytes } from './format-helpers.js';
import { enqueueSerial } from './task-autosave.js';
import { uploadRefFiles, imageFilesFrom, dragHasFiles, REF_ACCEPT } from './ref-upload.js';

/** The panel of the currently mounted task receives pasted images. */
let activePanel = null;
document.addEventListener('paste', (e) => {
  if (!activePanel?.el.isConnected) return;
  const files = imageFilesFrom(e.clipboardData);
  if (!files.length) return;
  e.preventDefault();
  void activePanel.upload(files);
});

export function createRefImagesPanel({ task, onRefsChanged, onRefRemoved }) {
  const fileInput = h('input', {
    type: 'file', accept: REF_ACCEPT, multiple: true, hidden: true,
    onChange: (e) => { const files = [...e.target.files]; e.target.value = ''; void upload(files); },
  });
  const status = h('span', { class: 'muted small' });
  const list = h('ol', { class: 'ref-list' });
  const el = h('section', { class: 'ref-panel', 'aria-label': 'Reference images' },
    h('div', { class: 'row between' },
      h('div', {}, h('span', { class: 'field-label' }, 'Reference images'), ' ', status),
      button('Upload images', () => fileInput.click())),
    h('p', { class: 'field-note' }, 'Order = image order sent to the model. Drag to reorder; drop or paste images here.'),
    list, fileInput);
  let dragId = null; // id of the ref being reordered

  el.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    el.classList.add('drop-active');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-active');
  });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-active');
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    void upload(imageFilesFrom(e.dataTransfer));
  });

  async function upload(files) {
    if (!files.length) return;
    status.textContent = `Uploading ${files.length}…`;
    el.classList.add('busy');
    try {
      const count = await uploadRefFiles(task.id, files);
      if (count) {
        await refreshRefs();
        showToast(`${count} reference image${count > 1 ? 's' : ''} uploaded`, 'success');
      }
    } finally {
      status.textContent = '';
      el.classList.remove('busy');
    }
  }

  /** Reload refs only (other task fields may have unsaved local edits). */
  async function refreshRefs() {
    try {
      const fresh = await api.get(`/api/tasks/${enc(task.id)}`);
      task.refs = sortRefs(fresh?.refs);
      render();
      onRefsChanged();
    } catch (err) { reportError(err, 'Could not refresh reference images'); }
  }

  async function applyOrder(ids) {
    const previous = task.refs;
    const byId = new Map(previous.map((r) => [r.id, r]));
    task.refs = ids.map((id, i) => ({ ...byId.get(id), order: i }));
    render();
    onRefsChanged();
    try {
      await enqueueSerial(() => api.put(`/api/tasks/${enc(task.id)}/refs/order`, { ids }));
    } catch (err) {
      task.refs = previous;
      render();
      onRefsChanged();
      reportError(err, 'Could not reorder reference images');
    }
  }

  async function remove(ref, index) {
    const ok = await confirmAction({
      title: 'Remove reference image',
      message: `Remove image #${index + 1} (${ref.filename})? Its @Image chips are removed from the prompt.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.del(`/api/tasks/${enc(task.id)}/refs/${enc(ref.id)}`);
      task.refs = task.refs.filter((r) => r.id !== ref.id);
      onRefRemoved(ref.id);
      render();
      onRefsChanged();
    } catch (err) { reportError(err, 'Could not remove reference image'); }
  }

  function renderItem(ref, index) {
    const li = h('li', { class: 'ref-item', draggable: true, dataset: { refId: ref.id }, title: ref.filename },
      h('span', { class: 'ref-number' }, `#${index + 1}`),
      h('img', { src: ref.url, alt: `Reference image ${index + 1}`, draggable: false, loading: 'lazy' }),
      h('span', { class: 'ref-name small' }, ref.filename),
      h('span', { class: 'ref-size muted small' }, formatBytes(ref.bytes)),
      h('button', {
        type: 'button', class: 'icon-btn ref-remove', 'aria-label': `Remove image ${index + 1}`,
        onClick: () => remove(ref, index),
      }, '×'));
    li.addEventListener('dragstart', (e) => {
      dragId = ref.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-ref-id', ref.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      list.querySelectorAll('.ref-item').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === ref.id) return;
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      const after = li.classList.contains('drop-after');
      const moving = dragId;
      const ids = task.refs.map((r) => r.id).filter((id) => id !== moving);
      const target = ids.indexOf(ref.id);
      if (target < 0) return;
      ids.splice(after ? target + 1 : target, 0, moving);
      if (ids.join() !== task.refs.map((r) => r.id).join()) void applyOrder(ids);
    });
    return li;
  }

  function render() {
    clear(list);
    const refs = task.refs ?? [];
    if (!refs.length) {
      list.append(h('li', { class: 'ref-empty muted' }, 'No reference images. Upload, drop or paste images here.'));
      return;
    }
    refs.forEach((ref, i) => list.append(renderItem(ref, i)));
  }

  render();
  const panel = { el, upload, render, applyOrder };
  activePanel = panel;
  return panel;
}
