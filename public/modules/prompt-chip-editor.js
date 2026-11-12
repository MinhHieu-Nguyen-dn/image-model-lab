/**
 * Prompt editor: contenteditable text with inline reference chips ("@Image N").
 *
 * - Typing "@" opens the reference picker; selecting inserts a chip bound to the ref id.
 * - Enter inserts a newline; Backspace/Delete next to a chip removes it as a unit.
 * - Paste inserts plain text only (image files bubble up to the reference uploader).
 * - Chip labels follow the current ref order via refreshChips(); stripRef() removes chips.
 */
import { h } from './dom-helpers.js';
import { imageFilesFrom } from './ref-upload.js';
import { createMentionPicker } from './ref-mention-picker.js';
import {
  serializeEditor, fillEditor, ensureTrailingBreak, createChipElement,
} from './prompt-chip-serialization.js';
import {
  placeCaret, insertNodeAtCaret, removeAdjacentChip, caretRect,
} from './contenteditable-caret-helpers.js';

export function createPromptChipEditor({ value, getRefs, onChange, onFiles }) {
  const root = h('div', {
    class: 'prompt-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': 'Prompt', spellcheck: 'true',
    'data-placeholder': 'Describe the image. Type @ to reference an uploaded image.',
  });
  const picker = createMentionPicker({ onSelect: insertChip });
  let lastValue = '';
  let mention = null; // { node, start, end, query } for the active "@query"
  let dismissed = null; // "@" the user escaped from; do not reopen for it

  /** Set chip text to its current 1-based position, or mark it dangling. */
  function labelChip(chip) {
    const refs = getRefs();
    const index = refs.findIndex((r) => r.id === chip.dataset.refId);
    chip.textContent = index >= 0 ? `@Image ${index + 1}` : '@Image ?';
    chip.classList.toggle('dangling', index < 0);
    chip.title = index >= 0 ? (refs[index].filename ?? '') : 'This reference image no longer exists';
    return chip;
  }
  const makeChip = (refId) => labelChip(createChipElement(refId));

  function commit() {
    ensureTrailingBreak(root);
    const next = serializeEditor(root);
    root.classList.toggle('is-empty', next === '');
    if (next !== lastValue) {
      lastValue = next;
      onChange(next);
    }
  }

  /** Detect "@query" immediately before the caret within one text node. */
  function findMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
    const before = node.nodeValue.slice(0, range.startOffset);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    const query = before.slice(at + 1);
    if (/\s/.test(query) || query.length > 20) return null;
    if (at > 0 && /[\p{L}\p{N}_]/u.test(before[at - 1])) return null; // e.g. "name@host"
    if (dismissed && dismissed.node === node && dismissed.start === at) return null;
    return { node, start: at, end: range.startOffset, query };
  }

  function mentionItems(query) {
    const q = query.toLowerCase();
    return getRefs()
      .map((ref, i) => ({ id: ref.id, n: i + 1, url: ref.url, filename: ref.filename }))
      .filter((it) => !q || `image ${it.n}`.startsWith(q) || `image${it.n}`.startsWith(q)
        || String(it.n).startsWith(q) || String(it.filename ?? '').toLowerCase().includes(q));
  }

  /** Open/update the picker for the current caret, or close it when no "@query" is active. */
  function updateMention() {
    mention = findMention();
    if (!mention) { picker.close(); return; }
    picker.open(caretRect(root), mentionItems(mention.query));
  }

  function closeMention() {
    mention = null;
    picker.close();
  }

  function insertChip(item) {
    const m = mention;
    closeMention();
    if (!m || !m.node.isConnected) return;
    const range = document.createRange();
    range.setStart(m.node, m.start);
    range.setEnd(m.node, Math.min(m.end, m.node.length));
    range.deleteContents();
    const chip = makeChip(item.id);
    range.insertNode(chip);
    const next = chip.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && /^\s/.test(next.nodeValue)) {
      placeCaret((r) => r.setStart(next, 1));
    } else {
      const space = document.createTextNode(' ');
      chip.after(space);
      placeCaret((r) => r.setStartAfter(space));
    }
    commit();
  }

  root.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (picker.isOpen() && e.key === 'Escape') {
      e.preventDefault();
      if (mention) dismissed = { node: mention.node, start: mention.start };
      closeMention();
      return;
    }
    if (picker.handleKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      insertNodeAtCaret(root, document.createTextNode('\n'));
      commit();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && removeAdjacentChip(e.key === 'Backspace')) {
      e.preventDefault();
      commit();
    }
  });
  root.addEventListener('input', () => { commit(); updateMention(); });
  root.addEventListener('keyup', (e) => {
    if (picker.isOpen() && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateMention();
  });
  root.addEventListener('click', () => { if (picker.isOpen()) updateMention(); });
  root.addEventListener('blur', closeMention);
  root.addEventListener('paste', (e) => {
    if (imageFilesFrom(e.clipboardData).length) return; // handled by the document-level ref uploader
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
    if (!text) return;
    insertNodeAtCaret(root, document.createTextNode(text));
    commit();
    closeMention();
  });
  // Never let rich content be dropped in; dropped image files become reference images.
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = imageFilesFrom(e.dataTransfer);
    if (files.length) onFiles(files);
  });

  function setValue(nextValue) {
    closeMention();
    fillEditor(root, nextValue ?? '', makeChip);
    lastValue = serializeEditor(root);
    root.classList.toggle('is-empty', lastValue === '');
  }
  setValue(value);

  return {
    el: root,
    getValue: () => lastValue,
    setValue,
    /** Relabel every chip after a reorder / upload / delete. */
    refreshChips() {
      root.querySelectorAll('.ref-chip').forEach(labelChip);
      if (picker.isOpen()) updateMention();
    },
    /** Remove all chips bound to a deleted reference image. */
    stripRef(refId) {
      const chips = [...root.querySelectorAll('.ref-chip')].filter((c) => c.dataset.refId === refId);
      chips.forEach((c) => c.remove());
      if (chips.length) commit();
    },
    dispose: closeMention,
  };
}
