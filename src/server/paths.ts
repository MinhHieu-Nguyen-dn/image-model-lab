/**
 * Filesystem layout under the images directory and safe path resolution.
 *
 * Layout:
 *   <images>/studio.db, <images>/credentials.json
 *   <images>/projects/<pid>/tasks/<tid>/refs/<refId>.<ext>
 *   <images>/projects/<pid>/tasks/<tid>/runs/<runId>/<modelKey>-<i>.<ext>
 * Only files under `projects/` are ever exposed via `/files/*`.
 */
import { resolve, sep, relative } from "node:path";

export function projectDir(imagesDir: string, pid: string): string {
  return resolve(imagesDir, "projects", pid);
}

export function taskDir(imagesDir: string, pid: string, tid: string): string {
  return resolve(projectDir(imagesDir, pid), "tasks", tid);
}

export function refsDir(imagesDir: string, pid: string, tid: string): string {
  return resolve(taskDir(imagesDir, pid, tid), "refs");
}

export function runDir(imagesDir: string, pid: string, tid: string, runId: string): string {
  return resolve(taskDir(imagesDir, pid, tid), "runs", runId);
}

/** Public URL (served by /files) for an absolute path inside the images dir. */
export function fileUrl(imagesDir: string, absPath: string): string {
  const rel = relative(resolve(imagesDir), absPath).split(sep).map(encodeURIComponent).join("/");
  return `/files/${rel}`;
}

/**
 * Resolves a URL sub-path inside `root`, returning null on traversal attempts,
 * NUL bytes or malformed percent-encoding.
 */
export function safeResolve(root: string, urlSubPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlSubPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const absRoot = resolve(root);
  const target = resolve(absRoot, "." + "/" + decoded.replace(/^\/+/, ""));
  if (target !== absRoot && !target.startsWith(absRoot + sep)) return null;
  return target;
}
