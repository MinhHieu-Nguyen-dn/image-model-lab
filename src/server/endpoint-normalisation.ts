/**
 * Model Studio endpoint normalisation.
 * Accepts a full URL or a bare host (with or without scheme), e.g.
 * `ws-xxx.ap-southeast-1.maas.aliyuncs.com`, or an SDK base URL ending in
 * `/api/v1` or `/compatible-mode/v1`. Unless the path already contains a `/services/`
 * segment (a full request URL), the DashScope sync multimodal-generation path is appended.
 */
import { HttpError } from "./http-utils.ts";

export const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

export function normaliseEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new HttpError(400, "Endpoint must not be empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, `Endpoint is not a valid URL: ${trimmed}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "Endpoint must use http or https");
  }
  if (!url.hostname) throw new HttpError(400, "Endpoint has no host");
  // A pasted full request URL is kept. Anything shorter (bare host, or an SDK-style base URL such as
  // `/api/v1` or `/compatible-mode/v1`) is completed with the DashScope sync generation path.
  if (!url.pathname.includes("/services/")) {
    const base = url.pathname.replace(/\/+$/, "").replace(/\/(?:api|compatible-mode)\/v1$/i, "");
    url.pathname = base + GENERATION_PATH;
  }
  url.hash = "";
  return url.toString();
}
