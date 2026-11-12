# Qwen Image Studio — plan and API contract

Status: in progress. Stack: Bun 1.3 + `bun:sqlite` + vanilla ES-module frontend (no build step, no CDN).
Run: `bun start` → http://127.0.0.1:4173 (env `PORT` overrides). Bind 127.0.0.1 only.

## Confirmed Done means
1. One command starts the server; UI loads; `./images/` auto-created.
2. Projects and Tasks: create/rename/delete from UI; persist across restarts.
3. Credentials: global + optional per-project override (endpoint + API key). Save runs a no-cost probe
   (401/403 invalid key, 400/422 reachable+key accepted, 404 wrong path, network error) shown in UI.
   Key masked everywhere; no API response ever contains the full key.
4. Catalog of 4 models (Qwen Image 3.0, 3.0 Pro, 2.1 Pro, 2.1 Ultra): editable API id, price/image,
   max ref images, negative_prompt support. Wrong id fails only that model's card.
5. Task form: prompt, negative prompt, size, n, seed, prompt_extend, 0..n ordered reference images, 1..4 models.
   Run executes selected models in parallel with identical inputs.
6. Ordered refs: fixed numbering #1..#N, drag reorder; list order == order of `{image}` items in API
   `content`, followed by exactly one `{text}` item. `@` in prompt opens picker and inserts chip bound to the image;
   reorder updates chip numbers. On Run chips compile to text via editable template (default `image {n}`).
   "View request" shows compiled payload (images abbreviated); each run stores it.
7. Per-model result card: images, latency, status/error, request_id, actual size, file size, image count, seed,
   rewritten prompt/rewrite_status if returned, raw usage JSON, estimated cost. Run history per task.
8. Over-limit refs: that model's card fails with clear message, NO API call; unsupported params omitted and noted.
9. All data under `./images/`; `.gitignore` ignores `images/`; `images/credentials.json` mode 600.
10. Automated tests against a mock Model Studio server pass (probe outcomes; parallel run all-ok / partial / all fail;
    key never leaked; content order; compiled face-swap text "image 1 -> image 2"; limit handling).
Non-goals: auth, multi-user, cloud deploy, video, async-polling APIs, rating, prompt library.
Waived: real end-to-end run with the user's key — user performs it in the UI (reported as unverified).

## File ownership
- Backend agent: `package.json`, `tsconfig.json`, `.gitignore`, `src/server/**`, `scripts/mock-model-studio.ts`, `tests/**`.
  Also serves `public/` statically and `/files/*` from `images/`.
- Frontend agent: `public/**` only (index.html, app.js, modules, styles.css).
Neither touches the other's files.

## Storage layout (under ./images)
- `studio.db` (SQLite): projects, tasks, refs, runs, run_results, settings (catalog + ref template).
- `credentials.json` (mode 600): `{ global: {endpoint, apiKey}, projects: { "<pid>": {endpoint, apiKey} } }`.
- `projects/<pid>/tasks/<tid>/refs/<refId>.<ext>`; `projects/<pid>/tasks/<tid>/runs/<runId>/<modelKey>-<i>.png`.
- Served read-only at `/files/<path relative to images/>`.

## API (JSON; errors `{error: string}` with proper HTTP status)
Projects: `GET /api/projects` · `POST /api/projects {name}` · `PATCH /api/projects/:pid {name}` · `DELETE /api/projects/:pid`
Tasks: `GET /api/projects/:pid/tasks` · `POST /api/projects/:pid/tasks {name}` · `GET /api/tasks/:tid` ·
 `PATCH /api/tasks/:tid {name?, prompt?, negativePrompt?, size?, n?, seed?, promptExtend?, models?: string[]}` · `DELETE /api/tasks/:tid`
 Task JSON: `{id, projectId, name, prompt, negativePrompt, size:"1024*1024", n, seed:number|null, promptExtend:bool,
 models:[modelKey], refs:[{id, order, filename, mime, bytes, url}], createdAt, updatedAt}`.
 `prompt` is stored with chip tokens `{{ref:<refId>}}`.
Refs: `POST /api/tasks/:tid/refs` (multipart field `file`; jpg/jpeg/png/bmp/tiff/webp/gif, ≤10MB) ·
 `PUT /api/tasks/:tid/refs/order {ids:[refId...]}` · `DELETE /api/tasks/:tid/refs/:refId` (removes chips? no — server leaves
 prompt; compile errors on dangling chip, UI strips chip on delete).
Credentials: `GET /api/credentials` → `{global:{endpoint, apiKeyMasked, hasKey}|null, effective?}` ·
 `PUT /api/credentials {endpoint, apiKey?}` (apiKey omitted ⇒ keep stored) → `{saved:true, credentials:{...masked}, test:TestResult}` ·
 `GET|PUT|DELETE /api/projects/:pid/credentials` (same shape; DELETE clears override) ·
 `POST /api/credentials/test {projectId?, endpoint?, apiKey?}` (omitted fields fall back to stored/effective) → `TestResult`.
 `TestResult = {ok:bool, kind:"ok"|"invalid_key"|"wrong_path"|"unreachable"|"unexpected", httpStatus?, message, latencyMs}`.
 Endpoint normalisation: accepts full URL or bare host (e.g. `https://ws-xxx.ap-southeast-1.maas.aliyuncs.com`);
 if the path has no `/api/`, append `/api/v1/services/aigc/multimodal-generation/generation`.
 Effective credentials for a project = project override if present else global.
Catalog/settings: `GET /api/catalog` · `PUT /api/catalog {models:[{key,label,apiModel,pricePerImage,maxRefImages,supportsNegativePrompt}], refTemplate}`.
 Defaults: keys `qwen-image-3.0` (3.0, max 3, neg yes), `qwen-image-3.0-pro` (max 3, neg yes), `qwen-image-2.1-pro` (max 10, neg no),
 `qwen-image-2.1-ultra` (max 10, neg no); apiModel defaults equal to the key; price 0; refTemplate `image {n}`.
Compile: `POST /api/tasks/:tid/compile {models?:[key]}` → `{text, refOrder:[refId], perModel:{<key>:{apiModel, ok, error?, omittedParams:[], payload}}}`
 (payload = exact request body with images replaced by `"<image #k: filename, bytes>"`).
Runs: `POST /api/tasks/:tid/runs {models?:[key]}` snapshots task inputs, returns `202 Run` immediately with status running;
 `GET /api/runs/:rid` · `GET /api/tasks/:tid/runs` (newest first).
 `Run = {id, taskId, createdAt, status:"running"|"done", inputs:{prompt, compiledText, negativePrompt, size, n, seed, promptExtend, refs:[...]},
  results:[ModelResult]}`.
 `ModelResult = {modelKey, label, apiModel, status:"pending"|"running"|"ok"|"error"|"skipped", error?, httpStatus?, latencyMs?, requestId?,
  images:[{url, width, height, bytes}], imageCount?, seed?, rewriteStatus?, rewrittenPrompt?, usage?(raw), estCost?, omittedParams:[], payload}`.
 Latency = wall time of the HTTP call measured server-side (excludes image download); image download time reported separately as `downloadMs`.

## Upstream request/response (DashScope sync)
POST endpoint, `Authorization: Bearer <key>`, body
`{model, input:{messages:[{role:"user", content:[{image: dataURI}, ..., {text}]}]}, parameters:{size:"w*h", n, seed?, negative_prompt? (only if supportsNegativePrompt), prompt_extend, watermark:false}}`.
Response: `output.choices[].message.content[].image` (24h URL ⇒ download immediately into images/), `usage`, `request_id`, error `{code,message,request_id}`.
Limits (docs): 3.0 series 1–3 refs, 2.1 series 1–10; seed 0..2147483647; n 1..6; size area 512²..2048², ratio 1:8..8:1; ref ≤10MB.
