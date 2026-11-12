/**
 * Small HTTP helpers shared by all route modules: JSON responses, typed HTTP errors
 * and safe JSON body parsing. Errors are always rendered as `{error: string}`.
 */

/** Error carrying an HTTP status; thrown by handlers/stores and rendered by the router. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

/** Parses a JSON object body; rejects non-objects and malformed JSON with 400. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  // Requiring application/json forces a CORS preflight for cross-site callers (text/plain would not).
  // A body-less request may omit the header, but one that declares another type is refused.
  const type = req.headers.get("content-type");
  if ((raw.trim() || type) && !/^application\/json\b/i.test(type ?? "")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Reads a required, trimmed, non-empty name (projects/tasks). */
export function requireName(body: Record<string, unknown>, field = "name"): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `'${field}' must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > 200) throw new HttpError(400, `'${field}' must be at most 200 characters`);
  return trimmed;
}

/** Narrowing helper for unknown JSON values. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
