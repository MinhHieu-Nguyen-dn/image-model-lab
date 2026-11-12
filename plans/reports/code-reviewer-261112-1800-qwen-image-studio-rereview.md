# Re-review: qwen-image-studio (adversarial, post-fix)

Scope: all of src/server (19 files), public/ (27 modules), tests/, scripts/mock. typecheck clean; `bun test` 52/52 pass.
Probes (throwaway, in scratchpad, app started in-process on port 0 and stopped): Origin `null`, missing/duplicate Host, absolute-form request target, `/files` traversal (`..%2F`, `%2e%2e`, raw `..`), public traversal, empty-body text/plain POST, Bun fetch Authorization on cross-origin redirect.

## Verdict
Critical/High: none. The C1/H1 key-exfiltration path is closed. One Medium (clickjacking), the rest Low.

## Fix verification
- request-guard.ts:11-20: Host must be exactly `127.0.0.1:PORT` or `localhost:PORT`. Missing Host, duplicate Host and rebinding hosts all return 421. Any Origin other than those two returns 403 (`null` included). Browsers attach Origin to every cross-site POST/PUT/PATCH/DELETE and to CORS GETs, so a cross-site page cannot drive mutations. A no-cors GET reaches only read-only handlers, and the browser makes the response opaque to the attacker. Closed.
- model-studio-auth-store.ts:84-100 plus the routes: `reusableKey` compares `URL.origin`. Userinfo tricks (`https://host@evil`), a scheme change, a port change or a trailing-dot host all count as a different origin, so the stored key is not reused. Global PUT, project PUT, test and resolveEffective all go through this check. Closed.
- Redirects: a probe confirmed that Bun fetch drops `Authorization` on a cross-origin redirect, so an upstream 3xx cannot carry the key to another host.
- model-client.ts:119-135: a content-length precheck plus a streamed 50MB cap. Closed.
- runner.ts:122-133: allSettled keeps the images that downloaded, and cost is still recorded. Closed.
- runner.ts:95-98: `runExists` is checked before mkdir and write. A small race remains (L2).
- ref-store.ts:66-69: the caps are in place. A small race remains (L1).
- Path safety: ids in paths always come from DB rows that have already been checked to exist. Model keys match `^[A-Za-z0-9._-]{1,64}$` and are used only as a filename prefix (`<key>-<i>.<ext>`), so they cannot traverse. `/files` is restricted to `projects/` and refuses credentials.json and studio.db. Uploads keep only the allowlisted image extension, there is no SVG, and `nosniff` is set, so nothing scriptable is ever served.
- XSS: the frontend has no innerHTML or insertAdjacentHTML sinks. `h()` sets text with append/textContent. `src`/`href` only ever receive server-built `/files/...` URLs. Paste is forced to plain text and drop is blocked in the prompt editor. Filenames, prompts, upstream error text and rewrittenPrompt are all rendered as text. Clean.
- Payload and chips: refs are ordered by `ord`. The `{image}` items come first, in that order, then `{text}`. Chip `{n}` is the ref's 1-based position in the same ordered list, so numbering and payload order cannot drift. The replace callback avoids `$&` injection from the template. A chip pointing at a deleted ref returns 400. Ref bytes are read once per run, before the run row is inserted. Correct.
- Keys: the only places a key appears are the Authorization header and credentials.json. Errors and logs never contain it. The only exception is Bun's JSON.parse message on a corrupt credentials.json, which can show at most a 2-character fragment, and only in the local console.

## Medium
M1. No anti-framing headers, so clickjacking is possible. Evidence: `curl /` returns no `X-Frame-Options` and no CSP. Locations: static-files.ts:20-22 and http-utils.ts:16-20.
Scenario: a malicious page loads `http://127.0.0.1:4173/` in a transparent iframe. Top-level navigations and iframe loads carry no Origin header, and the Host header is valid, so the guard lets the page through. Inside the frame, the UI's own API calls are same-origin and are allowed. The user is lured into clicks that start paid runs (up to 4 models × n=6 per click), delete a project (two clicks: the button and the confirm), or edit the catalog. The attacker cannot read anything back and cannot type a key, so the impact is limited to spending money and destroying data. Recent Chrome versions may block or prompt for local-network iframes, but other browsers do not.
Fix: add `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` to every response. A stricter CSP (`default-src 'self'; img-src 'self' data: blob:`) would also be cheap defence in depth. Add one test that asserts the header on `/`.

## Low
L1. ref-store.ts:65-82: the cap checks run before awaits (`file.arrayBuffer`, `Bun.write`), so concurrent uploads can overshoot. Two parallel uploads with 9 refs already present end with 11 refs, or more than 40MB in total. If the task is deleted during an upload, the INSERT fails the foreign-key check (500) after `mkdirSync` and `Bun.write` have already recreated `projects/<pid>/tasks/<tid>/refs/` with an orphan file. Fix: after the awaits, recheck that the task exists and recount the caps inside one synchronous block immediately before the write and insert, and delete the file if the insert fails.
L2. runner.ts:95-98: `runExists`, then `mkdirSync`, then `await Bun.write`. A DELETE that runs `rmSync` in between lets `Bun.write` (which creates parent directories by default) recreate the run folder with one orphan image. The window is tiny. Fix: after the write, check `runExists` again and `rmSync(job.dir)` if the run is gone.
L3. routes/model-studio-auth-routes.ts:87: a project override saved without a key copies the global key into `projects[pid]` when the origins match. If the global key is later rotated, the override keeps silently using the stale key, and `effective` reports it as source "project". Fix: store `apiKey: ""` and let `resolveEffective` (auth-store.ts:116) borrow the global key at runtime, which it already does.
L4. http-utils.ts:30: an empty body returns `{}` before the content-type check, so POST `/runs` with an empty text/plain body is accepted. It is not exploitable cross-site, because Origin is enforced. As hardening, check content-type for every method that has a body, or require a body on mutation routes.
L5. project-task-store.ts:70-74: `deleteProject` removes the DB row and the files, then calls `loadAuth`. If credentials.json is corrupt, the request returns 500 even though the project is gone, and the override stays behind. Cosmetic.

## Recommended actions
1. Add the anti-framing headers (M1) and a test for them.
2. Optional: recheck after the awaits in addRef and saveImage (L1, L2); store an empty key for key-less overrides (L3).

## Unresolved questions
- The probe treats HTTP 400 as "key accepted". This assumes DashScope checks auth before it validates the body. Has this been confirmed against the live Singapore endpoint with a bad key? If not, a wrong key could show as OK.
