/**
 * ZIP download of the History images that satisfy the current filters. Entries are laid out as
 * `<project>/<task>/<runId>_<modelKey>-<n>.<ext>`; the run id keeps names unique even when two
 * projects or tasks share a name. Only files under `projects/` are ever archived.
 */
import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { AppContext } from "./app-context.ts";
import { HttpError } from "./http-utils.ts";
import type { HistoryImage } from "./image-history-store.ts";
import { safeResolve } from "./paths.ts";
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, zipStream, type ZipEntry } from "./zip-stream.ts";

/** A name safe as one path segment on every OS. */
function segment(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().replace(/^\.+/, "").slice(0, 80).trim();
  return cleaned || "untitled";
}

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Resolves an image URL (`/files/...`) to a regular file inside `projects/`, or null when missing. */
function imagePath(ctx: AppContext, url: string): { path: string; size: number } | null {
  if (!url.startsWith("/files/")) return null;
  const path = safeResolve(ctx.imagesDir, url.slice("/files/".length));
  if (!path || !path.startsWith(resolve(ctx.imagesDir, "projects") + sep)) return null;
  try {
    const stat = statSync(path);
    return stat.isFile() ? { path, size: stat.size } : null;
  } catch {
    return null;
  }
}

export function buildHistoryZip(ctx: AppContext, images: HistoryImage[]): Response {
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  let total = 0;
  for (const item of images) {
    const file = imagePath(ctx, item.image.url);
    if (!file) continue; // the file was removed from disk; the rest still downloads
    const ext = extname(file.path) || ".png";
    const dir = `${segment(item.projectName)}/${segment(item.taskName)}`;
    const base = `${item.runId}_${segment(item.modelKey)}-${item.imageIndex + 1}`;
    let name = `${dir}/${base}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${dir}/${base}-${n}${ext}`;
    used.add(name.toLowerCase());
    entries.push({ name, read: async () => new Uint8Array(await Bun.file(file.path).arrayBuffer()) });
    total += file.size;
  }
  if (!entries.length) throw new HttpError(404, "No images match these filters");
  if (entries.length > ZIP_MAX_ENTRIES || total > ZIP_MAX_BYTES) {
    throw new HttpError(413, "Too many images for one ZIP; narrow the filters");
  }
  return new Response(zipStream(entries), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="history-images-${timestamp(new Date())}.zip"`,
      "cache-control": "no-store",
    },
  });
}
