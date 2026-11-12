/**
 * Guards a loopback-only server against browser-driven attacks:
 *  - Host allowlist blocks DNS rebinding (a rebinding page keeps its own hostname in Host).
 *  - Origin allowlist blocks cross-site requests (CSRF-style "simple" POSTs); requests without
 *    an Origin header (curl, same-origin GET, tests) are allowed.
 * Applied to every route, including /files and static assets.
 */
import { errorResponse } from "./http-utils.ts";

/** Returns an error Response when the request is not from the local UI, else null. */
export function rejectForeignRequest(req: Request, port: number): Response | null {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!allowedHosts.includes(host)) return errorResponse(421, "Unexpected Host header; use http://127.0.0.1:" + port);

  const origin = req.headers.get("origin");
  if (origin !== null && !allowedHosts.some((h) => origin.toLowerCase() === `http://${h}`)) {
    return errorResponse(403, "Cross-origin requests are not allowed");
  }
  return null;
}
