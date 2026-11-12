/**
 * Thin fetch wrapper for the studio JSON API.
 * Errors (`{error}` bodies, non-2xx, network failures) become ApiError with a readable message.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** URL-encode a path segment (ids come from the server but are never trusted blindly). */
export const enc = (value) => encodeURIComponent(String(value));

async function request(method, path, body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(`Cannot reach the studio server (${err?.message ?? 'network error'})`, 0);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string'
      ? data.error
      : `HTTP ${res.status} ${res.statusText}`.trim();
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path),
};

/** Accept either a bare array or an object wrapping it under `key`. */
export function asArray(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
}

/** Refs sorted by their `order` field (server order is authoritative). */
export function sortRefs(refs) {
  return [...(Array.isArray(refs) ? refs : [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
