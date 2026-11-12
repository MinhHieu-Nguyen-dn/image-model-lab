# Roadmap: more providers beside Alibaba Cloud Model Studio

Goal: a task can pick models from several vendors and compare them on the same inputs, with the same stats (latency, size, usage, estimated cost). Model Studio stays a first-class provider; nothing here is a rewrite.

Provider facts below (parameters, limits, prices, model ids) change often. Check each vendor's current docs when implementing a phase, and do not trust this file for them.

## Where the code is coupled to Model Studio today

| Concern                          | File(s)                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| Credentials shape `{endpoint, apiKey}`, global + per project | `src/server/model-studio-auth-store.ts`, `routes/model-studio-auth-routes.ts` |
| Endpoint completion              | `src/server/endpoint-normalisation.ts`                                   |
| Request body (DashScope messages) | `src/server/upstream-payload-builder.ts`                                |
| HTTP call, connection probe, result download | `src/server/model-client.ts`                                 |
| Run orchestration                | `src/server/runner.ts`                                                   |
| Model entries (`apiModel`, price, ref limit, negative prompt) | `src/server/catalog-store.ts`               |
| Size, `n`, seed rules            | `src/server/generation-params-validation.ts`                             |
| Mock upstream for tests          | `scripts/mock-model-studio.ts`, `tests/`                                 |

Everything else (projects, tasks, refs, history, ratings, ZIP, UI shell) is already provider-neutral.

## Phase 1: provider abstraction (no behaviour change)

Introduce one interface and move Model Studio behind it.

```ts
interface ImageProvider {
  id: string;                      // "model-studio", "openai", ...
  label: string;
  probe(auth: ProviderAuth, model: string): Promise<TestResult>;
  plan(model: CatalogModel, inputs: GenerationInputs): ModelPlan;   // validation, omitted params, request preview
  generate(auth: ProviderAuth, plan: ModelPlan, signal: AbortSignal): Promise<ProviderResult>;
  capabilities(model: CatalogModel): ModelCapabilities;             // sizes, n, seed, negative prompt, ref limit, extra params
}
```

- `ProviderResult` normalises what the UI shows: images (bytes or URL), latency, request id, usage, rewritten prompt, raw response.
- Add `provider` to `CatalogModel` (default `model-studio`, so existing catalogs keep working).
- `credentials.json` becomes `{ version: 2, providers: { <id>: { global, projects } } }`, migrated in place from the current shape on first start. The file stays mode `0600`.
- `providers/model-studio/` holds the moved code; `runner.ts` only looks a provider up by `model.provider`.
- Done when: all existing tests pass unchanged apart from import paths, and a catalog with only Model Studio behaves exactly as before.

## Phase 2: provider-aware UI

- Settings: one credentials card per provider (global and per-project override, connection test on save).
- Catalog editor: `provider` column; models of a provider without credentials are flagged.
- Task form: size and parameter fields are rendered from `capabilities()` (free `w*h` for Model Studio, preset sizes and quality for others) instead of being hard-coded.
- Result card and History: show the provider; per-model counts stay keyed by model.

## Phase 3: OpenAI GPT Image

- Text-to-image through the Images API generations endpoint; with reference images through the edits endpoint (multipart upload). Reference limits differ from Qwen and come from `capabilities()`.
- Results usually arrive as base64, not a URL: `ProviderResult` accepts bytes, so the runner skips the download step.
- Parameters: size presets, quality, output format, background. Map the shared `n` and prompt; omit what a model does not support and say so on the card (the existing "omitted params" mechanism).
- Cost: price is token-based, so `estCost` is computed from the returned usage instead of a flat price per image. The catalog gains an optional per-token price table.
- Mock: extend `scripts/` with an OpenAI-shaped mock so tests stay offline.
- Done when: a task can run Qwen and GPT Image together and show both cards with latency, usage and estimated cost.

## Phase 4: further providers (ideas, in rough priority)

| Provider                     | Notes                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Any OpenAI-compatible endpoint | Reuses the Phase 3 adapter with a custom base URL; covers many gateways and self-hosted servers |
| Google Gemini image models   | Different auth and request shape; image comes back inline                                    |
| ByteDance Seedream           | Similar sync shape to Model Studio                                                           |
| Black Forest Labs FLUX       | Asynchronous: submit then poll, needs Phase 5 job support                                   |
| Stability AI                 | Multipart request; credit-based pricing                                                     |
| Aggregators (Replicate, fal) | One adapter, many models; polling or webhooks                                               |

Each provider is one folder implementing `ImageProvider`, one mock for tests and one README row. A contributor guide for adding a provider will be written once Phase 1 lands.

## Phase 5: cross-cutting

- Async providers: `generate` may return a job handle; the runner polls with backoff and a timeout, and interrupted jobs resume on restart (extends `recoverInterruptedRuns`).
- Cancel a running model or a whole run.
- Token-based or credit-based cost for every provider, with the price table editable in the UI.
- Import/export a project (tasks, refs, results) as a ZIP.

## Non-goals

Multi-user accounts, hosted deployment, video generation, and prompt libraries stay out of scope. The tool remains a single-user local app bound to loopback.
