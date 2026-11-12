/** API tests: parallel runs (all ok / partial / total failure), content order, over-limit, compile preview. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHarness, MOCK_GOOD_KEY, pngBytes, setupTask, type Harness } from "./helpers/test-harness.ts";

let h: Harness;
let tid: string;
const ALL = ["qwen-image-3.0", "qwen-image-3.0-pro", "qwen-image-2.1-pro", "qwen-image-2.1-turbo"];

beforeAll(async () => {
  h = await createHarness();
  ({ tid } = await setupTask(h));
  await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "a red fox", size: "640*512", n: 2, seed: 42, negativePrompt: "blurry", models: ALL });
});
afterAll(async () => {
  await h.close();
});

describe("runs", () => {
  test("all models ok in parallel; images downloaded with metadata", async () => {
    h.mock.requests.length = 0;
    const started = performance.now();
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, {});
    expect(post.status).toBe(202);
    expect(post.data.status).toBe("running");
    expect(post.data.results.every((r: any) => r.status === "pending" || r.status === "running")).toBe(true);
    expect(post.data.results).toHaveLength(4);
    const run = await h.waitForRun(post.data.id);
    // Sequential would be >= 300ms of mock latency; parallel finishes near the slowest (300ms).
    expect(performance.now() - started).toBeLessThan(1500);
    expect(run.results.every((r) => r.status === "ok")).toBe(true);
    for (const r of run.results) {
      expect(r.images).toHaveLength(2);
      expect(r.images[0]).toMatchObject({ width: 640, height: 512 });
      expect(r.images[0].bytes).toBeGreaterThan(0);
      expect(r.imageCount).toBe(2);
      expect(r.seed).toBe(42);
      expect(r.requestId).toBeTruthy();
      expect(r.latencyMs).toBeGreaterThanOrEqual(20);
      expect(r.usage).toMatchObject({ image_count: 2 });
      const file = await fetch(h.app.url + r.images[0].url);
      expect(file.status).toBe(200);
      expect(file.headers.get("content-type")).toContain("image/png");
    }
    const turbo = run.results.find((r) => r.modelKey === "qwen-image-2.1-turbo")!;
    expect(turbo.omittedParams).toEqual(["negative_prompt"]);
    expect(turbo.payload!.parameters.negative_prompt).toBeUndefined();
    expect(run.results[0].payload!.parameters.negative_prompt).toBe("blurry");
    expect(run.inputs.compiledText).toBe("a red fox");
    expect(h.mock.requests).toHaveLength(4);
  });

  test("estimated cost uses the 2K price only for 2K sizes and models that have one", async () => {
    const costs = async (size: string) => {
      expect((await h.api("PATCH", `/api/tasks/${tid}`, { size, n: 1 })).status).toBe(200);
      const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-3.0-pro", "qwen-image-2.1-pro"] });
      const run = await h.waitForRun(post.data.id);
      return Object.fromEntries(run.results.map((r) => [r.modelKey, r.estCost]));
    };
    expect(await costs("1024*1024")).toEqual({ "qwen-image-3.0-pro": 0.04, "qwen-image-2.1-pro": 0.04 });
    expect(await costs("2048*2048")).toEqual({ "qwen-image-3.0-pro": 0.075, "qwen-image-2.1-pro": 0.04 });
    await h.api("PATCH", `/api/tasks/${tid}`, { size: "640*512", n: 2 });
  });

  test("results are persisted as each model finishes, before the run completes", async () => {
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-3.0", "qwen-image-2.1-turbo"] });
    let sawPartial = false;
    for (let i = 0; i < 400 && !sawPartial; i++) {
      const { data } = await h.api("GET", `/api/runs/${post.data.id}`);
      const [fast, slow] = data.results;
      if (data.status === "done") break;
      sawPartial = fast.status === "ok" && slow.status === "running";
      await Bun.sleep(5);
    }
    expect(sawPartial).toBe(true);
    await h.waitForRun(post.data.id);
  });

  test("wrong api model id fails only that model", async () => {
    const cat = (await h.api("GET", "/api/catalog")).data;
    cat.models[1].apiModel = "qwen-image-fail-typo";
    expect((await h.api("PUT", "/api/catalog", cat)).status).toBe(200);
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, {});
    const run = await h.waitForRun(post.data.id);
    const byKey = Object.fromEntries(run.results.map((r) => [r.modelKey, r]));
    expect(byKey["qwen-image-3.0-pro"]).toMatchObject({ status: "error", httpStatus: 400 });
    expect(byKey["qwen-image-3.0-pro"].error).toContain("InvalidModel");
    expect(["qwen-image-3.0", "qwen-image-2.1-pro", "qwen-image-2.1-turbo"].every((k) => byKey[k].status === "ok")).toBe(true);
    cat.models[1].apiModel = "qwen-image-3.0-pro";
    await h.api("PUT", "/api/catalog", cat);
  });

  test("total failure (bad key) errors every model, run still completes", async () => {
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: "sk-badbadbadbad0000" });
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-3.0", "qwen-image-2.1-pro"] });
    const run = await h.waitForRun(post.data.id);
    expect(run.results).toHaveLength(2);
    expect(run.results.every((r) => r.status === "error" && r.httpStatus === 401)).toBe(true);
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
  });

  test("two refs: content order follows ref order, chips compile, reorder updates", async () => {
    const a = await h.upload(tid, "a.png", pngBytes(64, 64, [255, 0, 0]));
    const b = await h.upload(tid, "b.jpg.png", pngBytes(32, 32, [0, 0, 255]));
    expect(a.status).toBe(201);
    expect([a.data.order, b.data.order]).toEqual([1, 2]);
    const prompt = `Replace the face of the character in {{ref:${a.data.id}}} with the face of the character in {{ref:${b.data.id}}}`;
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt });

    const compiled = await h.api("POST", `/api/tasks/${tid}/compile`, { models: ["qwen-image-3.0"] });
    expect(compiled.data.text).toBe("Replace the face of the character in image 1 with the face of the character in image 2");
    expect(compiled.data.refOrder).toEqual([a.data.id, b.data.id]);
    const content = compiled.data.perModel["qwen-image-3.0"].payload.input.messages[0].content;
    expect(content[0].image).toMatch(/^<image #1: a\.png, \d+ bytes>$/);
    expect(content[1].image).toMatch(/^<image #2: b\.jpg\.png/);
    expect(content[2]).toEqual({ text: compiled.data.text });

    h.mock.requests.length = 0;
    const run = await h.waitForRun((await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-3.0"] })).data.id);
    expect(run.results[0].status).toBe("ok");
    expect(h.mock.requests[0].contentKinds).toEqual(["image", "image", "text"]);
    expect(h.mock.requests[0].text).toBe("Replace the face of the character in image 1 with the face of the character in image 2");

    const reordered = await h.api("PUT", `/api/tasks/${tid}/refs/order`, { ids: [b.data.id, a.data.id] });
    expect(reordered.data.refs.map((r: any) => [r.id, r.order])).toEqual([[b.data.id, 1], [a.data.id, 2]]);
    const again = await h.api("POST", `/api/tasks/${tid}/compile`, { models: ["qwen-image-3.0"] });
    expect(again.data.text).toBe("Replace the face of the character in image 2 with the face of the character in image 1");
  });

  test("over-limit refs: model skipped with message and no upstream call", async () => {
    for (let i = 0; i < 2; i++) await h.upload(tid, `extra${i}.png`, pngBytes(16, 16));
    h.mock.requests.length = 0;
    const compiled = await h.api("POST", `/api/tasks/${tid}/compile`, { models: ["qwen-image-3.0", "qwen-image-2.1-pro"] });
    expect(compiled.data.perModel["qwen-image-3.0"].ok).toBe(false);
    expect(compiled.data.perModel["qwen-image-2.1-pro"].ok).toBe(true);

    const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-3.0", "qwen-image-2.1-pro"] });
    const skipped = post.data.results.find((r: any) => r.modelKey === "qwen-image-3.0");
    expect(skipped.status).toBe("skipped");
    expect(skipped.error).toContain("at most 3 reference image(s) but 4");
    const run = await h.waitForRun(post.data.id);
    expect(run.results.find((r) => r.modelKey === "qwen-image-2.1-pro")!.status).toBe("ok");
    expect(h.mock.requests.map((r) => r.model)).toEqual(["qwen-image-2.1-pro"]);
    expect(h.mock.requests[0].imageCount).toBe(4);
  });

  test("validation: bad params and model selection rejected", async () => {
    expect((await h.api("PATCH", `/api/tasks/${tid}`, { n: 7 })).status).toBe(400);
    expect((await h.api("PATCH", `/api/tasks/${tid}`, { seed: -1 })).status).toBe(400);
    expect((await h.api("PATCH", `/api/tasks/${tid}`, { size: "100*100" })).status).toBe(400);
    expect((await h.api("POST", `/api/tasks/${tid}/runs`, { models: [] })).status).toBe(400);
    expect((await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["nope"] })).status).toBe(400);
  });

  test("history newest first; run files live under images/", async () => {
    const runs = (await h.api("GET", `/api/tasks/${tid}/runs`)).data;
    expect(runs.length).toBeGreaterThanOrEqual(5);
    expect(runs[0].createdAt >= runs[runs.length - 1].createdAt).toBe(true);
    const url: string = runs[runs.length - 1].results[0].images[0].url;
    expect(existsSync(join(h.imagesDir, decodeURIComponent(url.slice("/files/".length))))).toBe(true);
  });

  test("no response leaked the key", () => {
    for (const body of h.responses) expect(body).not.toContain(MOCK_GOOD_KEY);
  });
});
