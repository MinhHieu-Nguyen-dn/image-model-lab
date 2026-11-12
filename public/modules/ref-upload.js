/**
 * Reference image upload: client-side validation (type, size sanity cap) and multipart POST.
 * Model Studio accepts at most 10 MB per image; the server scales larger uploads down, so the
 * cap here only protects against absurdly large files (it mirrors the server's upload cap).
 */
import { api, enc } from './api-client.js';
import { formatBytes } from './format-helpers.js';
import { showToast, reportError } from './toast-notifications.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/webp', 'image/gif']);
const ALLOWED_EXT = /\.(jpe?g|png|bmp|tiff?|webp|gif)$/i;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const REF_ACCEPT = [...ALLOWED_TYPES].join(',');

/** Image files from a DataTransfer (drop or clipboard), in their original order. */
export function imageFilesFrom(dataTransfer) {
  return [...(dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/') || ALLOWED_EXT.test(f.name));
}

/** True when a drag carries files (as opposed to an internal reorder drag). */
export function dragHasFiles(e) {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

/** Returns an error message or null when the file is acceptable. */
export function validateRefFile(file) {
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return `${file.name || 'File'}: unsupported type (use jpg, png, bmp, tiff, webp or gif)`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name || 'File'}: larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
  return null;
}

/** One-line description of what the server did to an oversized upload. */
export function describeResize(name, resized) {
  const { from, to } = resized;
  return `${name} was scaled down to fit Model Studio's limits: ${from.width}×${from.height} (${formatBytes(from.bytes)}) → ${to.width}×${to.height} (${formatBytes(to.bytes)})`;
}

/**
 * Upload files one by one (keeps their order as #N, #N+1…).
 * Returns the number uploaded; toasts a notice for every image the server had to scale down.
 */
export async function uploadRefFiles(taskId, files) {
  let uploaded = 0;
  for (const file of files) {
    const problem = validateRefFile(file);
    if (problem) { showToast(problem, 'error'); continue; }
    const form = new FormData();
    form.append('file', file, file.name || `pasted-${Date.now()}.png`);
    try {
      const ref = await api.post(`/api/tasks/${enc(taskId)}/refs`, form);
      uploaded += 1;
      if (ref?.resized) showToast(describeResize(file.name || 'Image', ref.resized), 'info', 8000);
    } catch (err) {
      reportError(err, `Upload failed for ${file.name || 'image'}`);
    }
  }
  return uploaded;
}
