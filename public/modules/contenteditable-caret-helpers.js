/**
 * Caret/selection helpers for the contenteditable prompt editor.
 */
import { isChip } from './prompt-chip-serialization.js';

/** Collapse the selection to a position configured by `setter(range)`. */
export function placeCaret(setter) {
  const range = document.createRange();
  setter(range);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Insert a node at the caret (replacing any selection) inside `root`, caret after it. */
export function insertNodeAtCaret(root, node) {
  const sel = window.getSelection();
  if (sel.rangeCount && root.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
  } else {
    // No caret inside the editor: append before the trailing placeholder <br>.
    root.insertBefore(node, root.lastChild?.nodeName === 'BR' ? root.lastChild : null);
  }
  placeCaret((r) => r.setStartAfter(node));
}

/** Remove the chip directly before (Backspace) / after (Delete) a collapsed caret. */
export function removeAdjacentChip(backward) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const { startContainer: c, startOffset: o } = sel.getRangeAt(0);
  let node;
  if (c.nodeType === Node.TEXT_NODE) {
    if (backward ? o > 0 : o < c.length) return false;
    node = backward ? c.previousSibling : c.nextSibling;
  } else {
    node = backward ? c.childNodes[o - 1] : c.childNodes[o];
  }
  while (node?.nodeType === Node.TEXT_NODE && node.length === 0) {
    node = backward ? node.previousSibling : node.nextSibling;
  }
  if (!isChip(node)) return false;
  placeCaret((r) => r.setStartBefore(node));
  node.remove();
  return true;
}

/** Viewport rectangle of the caret (falls back to the editor box). */
export function caretRect(root) {
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const rects = sel.getRangeAt(0).getClientRects();
    if (rects.length) return rects[rects.length - 1];
  }
  return root.getBoundingClientRect();
}
