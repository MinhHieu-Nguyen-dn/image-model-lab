/**
 * Output size field: Resolution (1K / 2K / Custom) + Aspect ratio, with the exact pixel size shown.
 * Custom accepts any width × height within the documented limits (area 512²..2048², ratio 1:8..8:1).
 * Tier boundary (shared with the server's cost estimate): area above 1536² counts as 2K.
 */
import { h } from './dom-helpers.js';

// Sizes are multiples of 16 and stay within the 2048² pixel budget.
const TIERS = {
  '1K': {
    '1:1': '1024*1024', '16:9': '1376*768', '9:16': '768*1376', '4:3': '1184*864',
    '3:4': '864*1184', '3:2': '1248*832', '2:3': '832*1248',
  },
  '2K': {
    '1:1': '2048*2048', '16:9': '2688*1536', '9:16': '1536*2688', '4:3': '2368*1728',
    '3:4': '1728*2368', '3:2': '2496*1664', '2:3': '1664*2496',
  },
};
const RATIOS = Object.keys(TIERS['1K']);
const CUSTOM = 'Custom';
export const HIGH_RES_AREA = 1536 * 1536;

/** Returns an error message, or null when the size is acceptable. */
export function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return 'Width and height must be positive whole numbers.';
  }
  const area = width * height;
  if (area < 512 * 512 || area > 2048 * 2048) return 'Total pixels must be between 512×512 and 2048×2048.';
  const ratio = width / height;
  if (ratio > 8 || ratio < 1 / 8) return 'Aspect ratio must be between 1:8 and 8:1.';
  return null;
}

function parseSize(value) {
  const match = /^(\d+)\*(\d+)$/.exec(String(value ?? ''));
  return match ? [Number(match[1]), Number(match[2])] : [1024, 1024];
}

/** Finds the tier + ratio of a preset size, or null for anything else (shown as Custom). */
function findPreset(value) {
  for (const [tier, ratios] of Object.entries(TIERS)) {
    for (const [ratio, size] of Object.entries(ratios)) if (size === value) return { tier, ratio };
  }
  return null;
}

export function createSizeField({ value, onChange }) {
  const preset = findPreset(value);
  const [w0, h0] = parseSize(value);
  const resolution = h('select', { 'aria-label': 'Resolution' },
    [...Object.keys(TIERS), CUSTOM].map((t) => h('option', { value: t, selected: t === (preset?.tier ?? CUSTOM) }, t === CUSTOM ? 'Custom' : `${t} (~${t === '1K' ? '1' : '4'} MP)`)));
  const ratio = h('select', { 'aria-label': 'Aspect ratio' },
    RATIOS.map((r) => h('option', { value: r, selected: r === (preset?.ratio ?? '1:1') }, r)));
  const width = h('input', { type: 'number', min: 64, max: 16384, step: 1, value: String(w0), 'aria-label': 'Width' });
  const height = h('input', { type: 'number', min: 64, max: 16384, step: 1, value: String(h0), 'aria-label': 'Height' });
  const custom = h('div', { class: 'size-custom row', hidden: !!preset }, width, h('span', { class: 'muted' }, '×'), height);
  const summary = h('p', { class: 'field-note' });
  const error = h('p', { class: 'field-note error', hidden: true });

  function showSummary(w, hgt) {
    summary.textContent = `Output ${w}×${hgt} · billed as ${w * hgt > HIGH_RES_AREA ? '2K' : '1K'}`;
  }

  function applyPreset() {
    const size = TIERS[resolution.value][ratio.value];
    const [w, hgt] = parseSize(size);
    width.value = String(w);
    height.value = String(hgt);
    showSummary(w, hgt);
    onChange(size);
  }

  function commitCustom() {
    const w = Number(width.value);
    const hgt = Number(height.value);
    const problem = validateSize(w, hgt);
    error.hidden = !problem;
    error.textContent = problem ?? '';
    if (problem) return;
    showSummary(w, hgt);
    onChange(`${w}*${hgt}`);
  }

  resolution.addEventListener('change', () => {
    const isCustom = resolution.value === CUSTOM;
    custom.hidden = !isCustom;
    ratio.disabled = isCustom;
    error.hidden = true;
    if (isCustom) commitCustom();
    else applyPreset();
  });
  ratio.addEventListener('change', applyPreset);
  width.addEventListener('input', commitCustom);
  height.addEventListener('input', commitCustom);
  ratio.disabled = !preset;
  showSummary(w0, h0);

  return h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Resolution'),
    h('div', { class: 'row size-selects' }, resolution, ratio),
    custom, summary, error);
}
