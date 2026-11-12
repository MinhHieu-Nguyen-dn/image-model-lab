/**
 * Model Studio auth persistence in `<images>/credentials.json` (always mode 0600).
 * Shape: `{ global: {endpoint, apiKey} | null, projects: { <pid>: {endpoint, apiKey} } }`.
 * API keys never leave this module unmasked except through `resolveEffective`,
 * which is used only for upstream calls. Nothing here logs keys.
 */
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseEndpoint } from "./endpoint-normalisation.ts";
import { isRecord } from "./http-utils.ts";

export interface StoredAuth {
  endpoint: string;
  apiKey: string;
}

export interface AuthFile {
  global: StoredAuth | null;
  projects: Record<string, StoredAuth>;
}

export interface MaskedAuth {
  endpoint: string;
  apiKeyMasked: string;
  hasKey: boolean;
}

export interface EffectiveAuth extends StoredAuth {
  source: "project" | "global";
}

export const AUTH_FILE_NAME = "credentials.json";

function authFilePath(imagesDir: string): string {
  return join(imagesDir, AUTH_FILE_NAME);
}

function parseEntry(value: unknown): StoredAuth | null {
  if (!isRecord(value) || typeof value.endpoint !== "string") return null;
  return { endpoint: completeStoredEndpoint(value.endpoint), apiKey: typeof value.apiKey === "string" ? value.apiKey : "" };
}

/** Endpoints saved as a bare base URL (e.g. `.../api/v1`) are completed on read; unparsable ones stay as-is. */
function completeStoredEndpoint(endpoint: string): string {
  try {
    return normaliseEndpoint(endpoint);
  } catch {
    return endpoint;
  }
}

export function loadAuth(imagesDir: string): AuthFile {
  const path = authFilePath(imagesDir);
  if (!existsSync(path)) return { global: null, projects: {} };
  let raw: unknown;
  try {
    // A hand-made file may be group/world readable; tighten it on first load.
    if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${AUTH_FILE_NAME} is unreadable or corrupt: ${(err as Error).message}`);
  }
  const file: AuthFile = { global: null, projects: {} };
  if (!isRecord(raw)) return file;
  file.global = parseEntry(raw.global);
  if (isRecord(raw.projects)) {
    for (const [pid, entry] of Object.entries(raw.projects)) {
      const parsed = parseEntry(entry);
      if (parsed) file.projects[pid] = parsed;
    }
  }
  return file;
}

/** Atomic write: temp file created with 0600, then renamed; chmod enforced afterwards. */
export function saveAuth(imagesDir: string, data: AuthFile): void {
  const path = authFilePath(imagesDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/** `sk-abcdef123456789f3a...` -> `sk-****9f3a`; short keys only reveal their last 4 chars (or nothing). */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 10) return "****";
  if (key.length < 20) return `****${key.slice(-4)}`;
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

/** True when both endpoints are valid URLs with the same scheme + host + port. */
export function sameOrigin(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * The stored key may only be reused for the endpoint it was stored with (same origin);
 * otherwise a changed endpoint would silently receive a key meant for another host.
 * Returns undefined when there is nothing safe to reuse.
 */
export function reusableKey(endpoint: string, stored: StoredAuth | null | undefined): string | undefined {
  return stored?.apiKey && sameOrigin(endpoint, stored.endpoint) ? stored.apiKey : undefined;
}

export function maskEntry(entry: StoredAuth | null | undefined): MaskedAuth | null {
  if (!entry) return null;
  return { endpoint: entry.endpoint, apiKeyMasked: maskKey(entry.apiKey), hasKey: !!entry.apiKey };
}

/**
 * Effective auth for a project: the project override when present (falling back
 * to the global key if the override stores no key and shares the global host),
 * otherwise global.
 */
export function resolveEffective(file: AuthFile, projectId?: string | null): EffectiveAuth | null {
  const override = projectId ? file.projects[projectId] : undefined;
  if (override) {
    // A key-less override borrows the global key only when it targets the same host.
    return { endpoint: override.endpoint, apiKey: override.apiKey || reusableKey(override.endpoint, file.global) || "", source: "project" };
  }
  if (file.global) return { ...file.global, source: "global" };
  return null;
}

export function maskEffective(effective: EffectiveAuth | null): (MaskedAuth & { source: string }) | null {
  if (!effective) return null;
  return { endpoint: effective.endpoint, apiKeyMasked: maskKey(effective.apiKey), hasKey: !!effective.apiKey, source: effective.source };
}

/** Removes a project's override (used on project delete and DELETE of the override). */
export function deleteProjectAuth(imagesDir: string, pid: string): boolean {
  const file = loadAuth(imagesDir);
  if (!(pid in file.projects)) return false;
  delete file.projects[pid];
  saveAuth(imagesDir, file);
  return true;
}
