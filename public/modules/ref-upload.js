/**
 * Reference image upload: client-side validation (type, ≤10 MB) and multipart POST.
 */
import { api, enc } from './api-client.js';
import { showToast, reportError } from './toast-notifications.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/webp', 'image/gif']);
const ALLOWED_EXT = /\.(jpe?g|png|bmp|tiff?|webp|gif)$/i;
export const MAX_REF_BYTES = 10 * 1024 * 1024;
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
  if (file.size > MAX_REF_BYTES) return `${file.name || 'File'}: larger than 10 MB`;
  return null;
}

/** Upload files one by one (keeps their order as #N, #N+1…). Returns the number uploaded. */
export async function uploadRefFiles(taskId, files) {
  let uploaded = 0;
  for (const file of files) {
    const problem = validateRefFile(file);
    if (problem) { showToast(problem, 'error'); continue; }
    const form = new FormData();
    form.append('file', file, file.name || `pasted-${Date.now()}.png`);
    try {
      await api.post(`/api/tasks/${enc(taskId)}/refs`, form);
      uploaded += 1;
    } catch (err) {
      reportError(err, `Upload failed for ${file.name || 'image'}`);
    }
  }
  return uploaded;
}
