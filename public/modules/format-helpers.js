/**
 * Pure formatting helpers for latency, sizes, dates and costs.
 */

/** Convert a server timestamp (ISO string, epoch ms or epoch s) to epoch ms. */
export function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** Latency: "850 ms" below one second, otherwise "1.23 s". */
export function formatMs(ms) {
  const n = Number(ms);
  if (ms === null || ms === undefined || !Number.isFinite(n)) return '—';
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
}

/** Human-readable byte size. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Local date-time string for a server timestamp. */
export function formatDateTime(value) {
  if (value === null || value === undefined) return '';
  return new Date(toEpochMs(value)).toLocaleString();
}

/** Elapsed time since an epoch-ms instant, e.g. "3.4 s" or "1m 05s". */
export function formatElapsed(sinceMs) {
  const s = Math.max(0, (Date.now() - sinceMs) / 1000);
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
}

/** Estimated cost with up to 4 fraction digits (currency follows the catalog price). */
export function formatCost(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Shorten long text for list rows. */
export function truncate(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
