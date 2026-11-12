/**
 * Static file serving:
 *  - `/files/*` -> images/projects/** only (read-only, traversal-safe; never the DB or credentials file)
 *  - everything else non-API -> public/ with index.html fallback for extensionless paths
 */
import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { AppContext } from "./app-context.ts";
import { errorResponse } from "./http-utils.ts";
import { safeResolve } from "./paths.ts";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function fileResponse(path: string, cache: string): Response {
  return new Response(Bun.file(path), { headers: { "cache-control": cache, "x-content-type-options": "nosniff" } });
}

export function serveImagesFile(ctx: AppContext, subPath: string): Response {
  const projectsRoot = resolve(ctx.imagesDir, "projects");
  const target = safeResolve(ctx.imagesDir, subPath);
  if (!target || !target.startsWith(projectsRoot + sep) || !isFile(target)) return errorResponse(404, "File not found");
  return fileResponse(target, "private, max-age=3600");
}

export function servePublic(ctx: AppContext, pathname: string): Response {
  const target = safeResolve(ctx.publicDir, pathname === "/" ? "index.html" : pathname);
  if (target && isFile(target)) return fileResponse(target, "no-cache");
  const last = pathname.split("/").pop() ?? "";
  const index = join(ctx.publicDir, "index.html");
  if (!last.includes(".") && isFile(index)) return fileResponse(index, "no-cache");
  return errorResponse(404, "Not found");
}
