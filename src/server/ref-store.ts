/**
 * Ordered reference images of a task. Order is 1-based and contiguous (#1..#N);
 * it is the order of `{image}` items in the upstream `content` array.
 * Files live at projects/<pid>/tasks/<tid>/refs/<refId>.<ext>.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { AppContext } from "./app-context.ts";
import { newId, nowIso } from "./db.ts";
import { HttpError } from "./http-utils.ts";
import { fileUrl, refsDir } from "./paths.ts";
import { readImageInfo } from "./image-meta.ts";
import { fitReferenceImage, type ImageSummary } from "./ref-image-fitting.ts";

/** Largest file accepted on upload; anything above Model Studio's 10 MB input limit is scaled down on the way in. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Highest per-model ref limit in the docs (2.1 series); every run base64-encodes all refs once per model. */
export const MAX_REFS_PER_TASK = 10;
export const MAX_TOTAL_REF_BYTES = 40 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", bmp: "image/bmp",
  tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", gif: "image/gif",
};
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "bmp", "tiff", "tif", "webp", "gif"];

export interface RefJson {
  id: string;
  order: number;
  filename: string;
  mime: string;
  bytes: number;
  url: string;
}

interface RefRow { id: string; task_id: string; ord: number; filename: string; mime: string; bytes: number; rel_path: string }

function rowsFor(ctx: AppContext, tid: string): RefRow[] {
  return ctx.db.query<RefRow, [string]>("SELECT * FROM refs WHERE task_id = ? ORDER BY ord ASC").all(tid);
}

function toJson(ctx: AppContext, r: RefRow): RefJson {
  return { id: r.id, order: r.ord, filename: r.filename, mime: r.mime, bytes: r.bytes, url: fileUrl(ctx.imagesDir, resolve(ctx.imagesDir, r.rel_path)) };
}

export function listRefs(ctx: AppContext, _pid: string, tid: string): RefJson[] {
  return rowsFor(ctx, tid).map((r) => toJson(ctx, r));
}

/** True when the bytes look like the claimed format (TIFF has no parser in image-meta). */
function magicMatches(bytes: Uint8Array, ext: string): boolean {
  if (ext === "tif" || ext === "tiff") {
    return bytes.length > 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a));
  }
  const info = readImageInfo(bytes);
  if (!info) return false;
  const expected = ext === "jpg" ? "jpeg" : ext;
  return info.format === expected;
}

function assertRoomForRef(existing: RefRow[], incomingBytes: number): void {
  if (existing.length >= MAX_REFS_PER_TASK) throw new HttpError(400, `A task can have at most ${MAX_REFS_PER_TASK} reference images`);
  if (existing.reduce((sum, r) => sum + r.bytes, 0) + incomingBytes > MAX_TOTAL_REF_BYTES) {
    throw new HttpError(413, `Reference images of a task are limited to ${MAX_TOTAL_REF_BYTES / 1024 / 1024}MB in total`);
  }
}

/** Set when an upload had to be scaled down / re-encoded to satisfy Model Studio's input limits. */
export interface RefResizeNote {
  from: ImageSummary;
  to: ImageSummary;
}

export type AddedRef = RefJson & { resized?: RefResizeNote };

export async function addRef(ctx: AppContext, pid: string, tid: string, file: File): Promise<AddedRef> {
  let filename = (file.name || "image").slice(0, 200);
  let ext = extname(filename).slice(1).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) throw new HttpError(400, `Unsupported file type '.${ext}'; allowed: jpg, jpeg, png, bmp, tiff, webp, gif`);
  if (file.size === 0) throw new HttpError(400, "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `Reference image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
  assertRoomForRef(rowsFor(ctx, tid), 0);
  const original = new Uint8Array(await file.arrayBuffer());
  if (!magicMatches(original, ext)) throw new HttpError(400, `File content is not a valid ${ext.toUpperCase()} image`);

  // Oversized or over-dimensioned images are scaled down here, so what is stored (and later sent) always fits.
  const fitted = await fitReferenceImage(original, ext, MIME_BY_EXT[ext]);
  const bytes = fitted.bytes;
  if (fitted.resized) {
    ext = fitted.ext;
    filename = `${filename.replace(/\.[^./\\]+$/, "")}.${ext}`;
  }

  // Everything below is synchronous: the caps are re-checked against the current rows and the
  // file + row are written with no await in between, so parallel uploads and a task delete
  // during the read above cannot overshoot the caps or leave a stray file.
  if (!ctx.db.query("SELECT 1 FROM tasks WHERE id = ?").get(tid)) throw new HttpError(404, "Task not found");
  assertRoomForRef(rowsFor(ctx, tid), bytes.byteLength);
  const id = newId("r");
  const dir = refsDir(ctx.imagesDir, pid, tid);
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, `${id}.${ext}`);
  writeFileSync(abs, bytes);
  const rel = abs.slice(resolve(ctx.imagesDir).length + 1);
  const nextOrd = (ctx.db.query<{ m: number | null }, [string]>("SELECT MAX(ord) AS m FROM refs WHERE task_id = ?").get(tid)?.m ?? 0) + 1;
  try {
    ctx.db
      .query("INSERT INTO refs (id, task_id, ord, filename, mime, bytes, rel_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, tid, nextOrd, filename, MIME_BY_EXT[ext], bytes.byteLength, rel, nowIso());
  } catch (err) {
    rmSync(abs, { force: true });
    throw err;
  }
  const json = toJson(ctx, ctx.db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(id)!);
  return fitted.resized ? { ...json, resized: { from: fitted.from, to: fitted.to } } : json;
}

/** `ids` must be an exact permutation of the task's ref ids. */
export function reorderRefs(ctx: AppContext, tid: string, ids: unknown): void {
  const current = rowsFor(ctx, tid).map((r) => r.id);
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new HttpError(400, "'ids' must be an array of ref ids");
  const sameSet = ids.length === current.length && new Set(ids).size === ids.length && ids.every((x) => current.includes(x as string));
  if (!sameSet) throw new HttpError(400, "'ids' must list every ref of the task exactly once");
  const update = ctx.db.query("UPDATE refs SET ord = ? WHERE id = ?");
  ctx.db.transaction(() => (ids as string[]).forEach((id, i) => update.run(i + 1, id)))();
}

export function deleteRef(ctx: AppContext, tid: string, refId: string): void {
  const row = ctx.db.query<RefRow, [string, string]>("SELECT * FROM refs WHERE id = ? AND task_id = ?").get(refId, tid);
  if (!row) throw new HttpError(404, "Reference image not found");
  ctx.db.query("DELETE FROM refs WHERE id = ?").run(refId);
  rmSync(resolve(ctx.imagesDir, row.rel_path), { force: true });
  // Renumber remaining refs so numbering stays #1..#N.
  const update = ctx.db.query("UPDATE refs SET ord = ? WHERE id = ?");
  ctx.db.transaction(() => rowsFor(ctx, tid).forEach((r, i) => update.run(i + 1, r.id)))();
}

/** Reads a ref file as a base64 data URI for the upstream `content` array. */
export function refDataUri(ctx: AppContext, ref: RefJson): string {
  const row = ctx.db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(ref.id);
  if (!row) throw new HttpError(409, `Reference image ${ref.id} no longer exists`);
  let data: Buffer;
  try {
    data = readFileSync(resolve(ctx.imagesDir, row.rel_path));
  } catch {
    throw new HttpError(409, `Reference image file for #${ref.order} (${ref.filename}) is missing on disk`);
  }
  return `data:${row.mime};base64,${data.toString("base64")}`;
}
