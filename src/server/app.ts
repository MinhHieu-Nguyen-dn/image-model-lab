/**
 * App wiring: opens the data dir + DB, registers routes and exposes a Bun.serve
 * starter. Always binds 127.0.0.1. Used by main.ts and by tests (in-process).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "bun";
import type { AppContext } from "./app-context.ts";
import { openDatabase } from "./db.ts";
import { errorResponse } from "./http-utils.ts";
import { rejectForeignRequest } from "./request-guard.ts";
import { Router } from "./router.ts";
import { recoverInterruptedRuns } from "./run-store.ts";
import { registerCatalogCompileRunRoutes } from "./routes/catalog-compile-run-routes.ts";
import { registerImageRatingHistoryRoutes } from "./routes/image-rating-history-routes.ts";
import { registerAuthRoutes } from "./routes/model-studio-auth-routes.ts";
import { registerProjectTaskRoutes } from "./routes/project-task-routes.ts";
import { registerRefRoutes } from "./routes/ref-routes.ts";
import { serveImagesFile, servePublic } from "./static-files.ts";

export interface AppOptions {
  imagesDir: string;
  publicDir: string;
  port: number;
}

export interface RunningApp {
  ctx: AppContext;
  server: Server<undefined>;
  url: string;
  /** Waits for in-flight runs, then stops the server and closes the DB. */
  stop(): Promise<void>;
}

export function createContext(imagesDir: string, publicDir: string): AppContext {
  const absImages = resolve(imagesDir);
  mkdirSync(resolve(absImages, "projects"), { recursive: true });
  const ctx: AppContext = { db: openDatabase(absImages), imagesDir: absImages, publicDir: resolve(publicDir), pendingRuns: new Set() };
  recoverInterruptedRuns(ctx);
  return ctx;
}

export function buildRouter(): Router {
  const router = new Router();
  registerProjectTaskRoutes(router);
  registerRefRoutes(router);
  registerAuthRoutes(router);
  registerCatalogCompileRunRoutes(router);
  registerImageRatingHistoryRoutes(router);
  return router;
}

/** Stops other sites from framing the UI (clickjacking the run/delete buttons). */
function withFramingProtection(res: Response): Response {
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("content-security-policy", "frame-ancestors 'none'");
  return res;
}

export function startApp(opts: AppOptions): RunningApp {
  const ctx = createContext(opts.imagesDir, opts.publicDir);
  const router = buildRouter();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 60,
    // Largest legitimate body is a 50MB image upload (scaled down server-side) plus multipart overhead.
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(req) {
      const rejected = rejectForeignRequest(req, server.port ?? opts.port);
      if (rejected) return withFramingProtection(rejected);
      const { pathname } = new URL(req.url);
      let res: Response;
      if (pathname.startsWith("/api/")) res = (await router.handle(req, pathname, ctx)) ?? errorResponse(404, "Not found");
      else if (req.method !== "GET" && req.method !== "HEAD") res = errorResponse(405, "Method not allowed");
      else if (pathname.startsWith("/files/")) res = serveImagesFile(ctx, pathname.slice("/files/".length));
      else res = servePublic(ctx, pathname);
      return withFramingProtection(res);
    },
    error(err) {
      console.error(`Unhandled server error: ${err.message}`);
      return errorResponse(500, "Internal server error");
    },
  });
  return {
    ctx,
    server,
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      await Promise.allSettled([...ctx.pendingRuns]);
      await server.stop(true);
      ctx.db.close();
    },
  };
}
