# Re-review 2: qwen-image-studio, verification of the M1 and L1-L5 fixes

Checks: `bun run typecheck` is clean and `bun test` passes 56/56. A throwaway in-process probe (scratchpad, stopped afterwards) covered headers on every response path, the content-type rules and an oversize body.

## Verdict: clean
No Critical, High or Medium findings remain. Every fix closes its finding and none of them causes a regression.

## Fix verification
- **M1 (app.ts:52-56, 69, 76): closed.** Every path returned by `fetch` gets `X-Frame-Options: DENY` and `frame-ancestors 'none'`. The probe confirmed this for 200 GET, HEAD on `/`, 421 (bad Host), 403 (bad Origin), 405 (static and API), 404 (API), router errors and static files. Header mutation works on `Bun.file` responses.
- **L4 (http-utils.ts:28-36): closed.** The probe results:
  - Empty body with `text/plain`: 415.
  - Body sent with no content type at all: 415.
  - Form-urlencoded body: 415.
  - `application/json; charset=utf-8`: 201.
  - Empty body with no content type: passes the check (the 400 that follows comes from name validation).

  The frontend still works under the new rule:
  - `api-client.js` sets `Content-Type: application/json` whenever it sends a non-FormData body.
  - post/put/patch always send a body (default `{}`).
  - `get` and `del` send no body and no content type.
  - No DELETE route reads a body.
  - No module calls `fetch` directly.

  Multipart upload uses `req.formData()` instead of `readJsonObject`, so the new rule does not affect it, and the harness upload tests pass.
- **L1 (ref-store.ts:72-95): closed.** The code from the task-existence recheck through the cap recount, mkdir, `writeFileSync` and INSERT runs with no await, so it cannot interleave with another upload or with the synchronous `deleteTask` and `deleteProject`. If the INSERT fails, the file is removed. A parallel-upload test exists.
- **L2 (runner.ts:96-99): closed.** `runExists`, mkdir and `writeFileSync` run synchronously, and every delete path (task and project) is also synchronous. A write error (for example ENOSPC) rejects inside `allSettled`, so it is handled.
- **writeFileSync size:** up to 10MB for refs and up to the 50MB download cap per runner image. That blocks the event loop for tens of milliseconds at most, which is acceptable for a single-user loopback tool.
- **L3 (model-studio-auth-routes.ts:86-94): closed.** I traced each case:
  - Override on the global host with no key: stored as `""` and borrowed at runtime by `resolveEffective` (auth-store.ts:116). Rotating the global key carries through (tested).
  - Override with its own key, re-saved with no key: keeps its own key.
  - Endpoint changed to the global host: borrows the global key, and the old project key is never sent to the new host.
  - Endpoint changed to a third host with any key stored: 400.
  - Global key later moved to another host: the borrowing override resolves to `""` and the run fails with "No API key configured" instead of leaking the key.
  - Probe/test route: `base` is the effective auth, whose endpoint is the override's and has the same origin as the borrowed global key. A different-host test returns CHANGED_HOST. Correct.
  - Runner: uses `resolveEffective`. Correct.
- **L5 (project-task-store.ts:74-79): closed.** A corrupt credentials.json no longer turns a delete into a 500.

## Low / informational (non-blocking)
1. project-task-store.ts:76: the catch-all also hides real `saveAuth` failures (EACCES, ENOSPC) with no log. Fix: `console.error` the message (never the file contents).
2. app.ts:78-81: the `error()` fallback and Bun's built-in 413 for bodies over `maxRequestBodySize` have no anti-framing headers (probe: 413 had none). These are JSON or empty bodies with no UI to clickjack, so there is no practical impact. Optionally wrap the `error()` return.
3. L3 does not migrate existing data. Overrides that were saved with a copied global key before this fix still hold that stale copy. Re-saving the override with a key will not clear it. Only a manual edit, or DELETE then re-create, fixes it.
4. connection-settings-form.js:107: the UI requires a typed key when the override has none. So a borrowing override can only be created through the API, and a borrowing override shows "No key stored yet." This does not regress the server fix; it is a UX inconsistency only.
5. No test covers L5 (deleting a project with a corrupt credentials.json returns 200).

## Unresolved questions
- Is it intended that the UI blocks key-less (borrowing) project overrides? If so, the server-side borrow path is API-only.
