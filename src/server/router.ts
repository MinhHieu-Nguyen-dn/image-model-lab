/**
 * Tiny method + path-pattern router (`/api/tasks/:tid`). Handlers may throw
 * HttpError; unknown errors become 500 with a generic message (details logged).
 */
import type { AppContext } from "./app-context.ts";
import { errorResponse, HttpError } from "./http-utils.ts";

export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params, ctx: AppContext) => Response | Promise<Response>;

interface Route {
  method: string;
  regex: RegExp;
  names: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const names: string[] = [];
    const source = pattern
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          names.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), names, handler });
    return this;
  }

  /** Returns null when no route path matches (so the caller can 404). */
  async handle(req: Request, pathname: string, ctx: AppContext): Promise<Response | null> {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      const params: Params = {};
      try {
        route.names.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
        return await route.handler(req, params, ctx);
      } catch (err) {
        if (err instanceof URIError) return errorResponse(400, "Malformed percent-encoding in path");
        if (err instanceof HttpError) return errorResponse(err.status, err.message);
        console.error(`${req.method} ${pathname} failed: ${(err as Error)?.message ?? String(err)}`);
        return errorResponse(500, "Internal server error");
      }
    }
    return pathMatched ? errorResponse(405, "Method not allowed") : null;
  }
}
