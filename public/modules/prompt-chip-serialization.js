/**
 * Conversion between the stored prompt string and the contenteditable chip DOM.
 *
 * Stored format: plain text with `{{ref:<refId>}}` tokens. In the DOM a token is a
 * non-editable `<span class="ref-chip" data-ref-id>` and newlines are "\n" text
 * (the editor uses `white-space: pre-wrap`). The editor always ends with a placeholder
 * <br> so a trailing newline renders; the final <br> of the root is never serialised.
 */

/** Must stay identical to CHIP_RE in src/server/prompt-compiler.ts (ids are [A-Za-z0-9_-]). */
export const REF_TOKEN_RE = /\{\{ref:([A-Za-z0-9_-]+)\}\}/g;

/** Create an (unlabelled) chip element bound to a reference id. */
export function createChipElement(refId) {
  const chip = document.createElement('span');
  chip.className = 'ref-chip';
  chip.contentEditable = 'false';
  chip.dataset.refId = refId;
  return chip;
}

/** True when the node is a reference chip. */
export function isChip(node) {
  return node?.nodeType === Node.ELEMENT_NODE && Boolean(node.dataset?.refId);
}

/** Serialise editor DOM to the stored prompt string. */
export function serializeEditor(root) {
  let out = '';
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue.replace(/​/g, '');
      } else if (isChip(child)) {
        out += `{{ref:${child.dataset.refId}}}`;
      } else if (child.nodeName === 'BR') {
        if (!(parent === root && child === root.lastChild)) out += '\n';
      } else if (child.nodeName === 'DIV' || child.nodeName === 'P') {
        // Some browsers wrap lines in blocks; treat each block start as a line break.
        if (out && !out.endsWith('\n')) out += '\n';
        walk(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

/** Make sure the root ends with the placeholder <br>. */
export function ensureTrailingBreak(root) {
  if (root.lastChild?.nodeName !== 'BR') root.append(document.createElement('br'));
}

/** Rebuild editor content from a stored prompt string; `makeChip(refId)` returns a labelled chip. */
export function fillEditor(root, value, makeChip) {
  root.replaceChildren();
  const text = String(value ?? '');
  let last = 0;
  for (const match of text.matchAll(REF_TOKEN_RE)) {
    if (match.index > last) root.append(document.createTextNode(text.slice(last, match.index)));
    root.append(makeChip(match[1]));
    last = match.index + match[0].length;
  }
  if (last < text.length) root.append(document.createTextNode(text.slice(last)));
  ensureTrailingBreak(root);
}
