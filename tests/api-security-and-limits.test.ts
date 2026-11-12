/**
 * API tests for the local-server guards (Host/Origin/content-type), stored-key reuse rules,
 * partial image downloads, delete-during-run cleanup and reference upload caps.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadAuth, resolveEffective } from "../src/server/model-studio-auth-store.ts";
import { createHarness, MOCK_GOOD_KEY, noisePng, pngBytes, setupTask, type Harness } from "./helpers/test-harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("request guard", () => {
  test("foreign Origin is rejected before any outbound call is made", async () => {
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
    h.mock.requests.length = 0;
    const res = await fetch(`${h.app.url}/api/credentials/test`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ endpoint: h.mock.url }),
    });
    expect(res.status).toBe(403);
    expect(h.mock.requests).toHaveLength(0);
  });

  test("same-origin Origin is accepted", async () => {
    const res = await fetch(`${h.app.url}/api/projects`, { headers: { origin: h.app.url } });
    expect(res.status).toBe(200);
  });

  test("unexpected Host header (DNS rebinding) -> 421", async () => {
    const res = await fetch(`${h.app.url}/api/projects`, { headers: { host: "rebind.example:80" } });
    expect(res.status).toBe(421);
  });

  test("non-JSON content type on a JSON body -> 415 and nothing is probed", async () => {
    h.mock.requests.length = 0;
    const res = await fetch(`${h.app.url}/api/credentials/test`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ endpoint: h.mock.url }),
    });
    expect(res.status).toBe(415);
    expect(h.mock.requests).toHaveLength(0);
  });
});

describe("stored key is only reused for the origin it was saved with", () => {
  const otherHost = () => `http://localhost:${new URL(h.mock.url).port}`; // same port, different hostname = different origin

  test("PUT with a changed host and no key -> 400, stored endpoint unchanged", async () => {
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
    const res = await h.api("PUT", "/api/credentials", { endpoint: otherHost() });
    expect(res.status).toBe(400);
    const stored = (await h.api("GET", "/api/credentials")).data.global;
    expect(stored.endpoint).toContain("127.0.0.1");
  });

  test("test without a typed key against a different host never sends the stored key", async () => {
    h.mock.requests.length = 0;
    const res = await h.api("POST", "/api/credentials/test", { endpoint: otherHost() });
    expect(res.data).toMatchObject({ ok: false, kind: "invalid_key" });
    expect(h.mock.requests).toHaveLength(0);
  });

  test("a typed key works for a changed host", async () => {
    const res = await h.api("PUT", "/api/credentials", { endpoint: otherHost(), apiKey: MOCK_GOOD_KEY });
    expect(res.status).toBe(200);
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
  });

  test("project override on a different host needs its own key", async () => {
    const p = await h.api("POST", "/api/projects", { name: "host-change" });
    const res = await h.api("PUT", `/api/projects/${p.data.id}/credentials`, { endpoint: otherHost() });
    expect(res.status).toBe(400);
  });
});

describe("downloads and deletion during a run", () => {
  test("a failed second image keeps the first; a model whose images all fail is an error", async () => {
    const { tid } = await setupTask(h);
    const cat = (await h.api("GET", "/api/catalog")).data;
    const base = cat.models[0];
    cat.models.push({ ...base, key: "m-partial", label: "Partial", apiModel: "model-partial" });
    cat.models.push({ ...base, key: "m-noimg", label: "NoImg", apiModel: "model-noimg" });
    expect((await h.api("PUT", "/api/catalog", cat)).status).toBe(200);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "x", size: "640*512", n: 2 });
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["m-partial", "m-noimg"] });
    const run = await h.waitForRun(post.data.id);
    const byKey = Object.fromEntries(run.results.map((r) => [r.modelKey, r]));
    expect(byKey["m-partial"].status).toBe("ok");
    expect(byKey["m-partial"].images).toHaveLength(1);
    expect(byKey["m-partial"].error).toContain("1 of 2 image(s) could not be downloaded");
    expect(byKey["m-partial"].imageCount).toBe(2);
    expect(byKey["m-noimg"]).toMatchObject({ status: "error" });
    expect(byKey["m-noimg"].error).toContain("could not download any image");
    expect(byKey["m-noimg"].images).toHaveLength(0);
  });

  test("deleting the task mid-run leaves no files behind and the run is gone", async () => {
    const { pid, tid } = await setupTask(h);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "x", size: "512*512", n: 1 });
    // Turbo has a 300ms mock latency, long enough to delete while the request is in flight.
    const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models: ["qwen-image-2.1-turbo"] });
    expect(post.status).toBe(202);
    expect((await h.api("DELETE", `/api/tasks/${tid}`)).status).toBe(200);
    await Bun.sleep(600);
    expect((await h.api("GET", `/api/runs/${post.data.id}`)).status).toBe(404);
    expect(existsSync(join(h.imagesDir, "projects", pid, "tasks", tid))).toBe(false);
    const tasksDir = join(h.imagesDir, "projects", pid, "tasks");
    expect(existsSync(tasksDir) ? readdirSync(tasksDir) : []).not.toContain(tid);
  });
});

describe("reference upload caps", () => {
  test("at most 10 references per task", async () => {
    const { tid } = await setupTask(h);
    for (let i = 0; i < 10; i++) expect((await h.upload(tid, `r${i}.png`, pngBytes(8, 8))).status).toBe(201);
    const over = await h.upload(tid, "r10.png", pngBytes(8, 8));
    expect(over.status).toBe(400);
    expect(over.data.error).toContain("at most 10");
  });

  test("total reference bytes per task are capped", async () => {
    const { tid } = await setupTask(h);
    // Real ~5.9 MB incompressible images: under the 7 MB send limit (stored untouched), 7 of them exceed 40 MB.
    const big = await noisePng(1400, 1400, 3);
    expect(big.byteLength).toBeLessThan(7 * 1024 * 1024);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await h.upload(tid, `big${i}.png`, big)).status);
    expect(statuses.slice(0, 6)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(statuses[6]).toBe(413);
  });
});

describe("hardening", () => {
  test("every response forbids framing (clickjacking)", async () => {
    for (const path of ["/", "/api/projects", "/files/nope.png"]) {
      const res = await fetch(h.app.url + path);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });

  test("an empty body with a non-JSON content type is refused", async () => {
    const { tid } = await setupTask(h);
    const res = await fetch(`${h.app.url}/api/tasks/${tid}/runs`, { method: "POST", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
  });

  test("parallel uploads cannot exceed the reference cap", async () => {
    const { tid } = await setupTask(h);
    for (let i = 0; i < 9; i++) await h.upload(tid, `r${i}.png`, pngBytes(8, 8));
    const results = await Promise.all([0, 1, 2].map((i) => h.upload(tid, `p${i}.png`, pngBytes(8, 8))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await h.api("GET", `/api/tasks/${tid}`)).data.refs).toHaveLength(10);
  });

  test("a project override on the global host borrows the global key instead of copying it", async () => {
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
    const p = await h.api("POST", "/api/projects", { name: "borrow" });
    const put = await h.api("PUT", `/api/projects/${p.data.id}/credentials`, { endpoint: h.mock.url });
    expect(put.data.test.kind).toBe("ok");
    expect(loadAuth(h.imagesDir).projects[p.data.id].apiKey).toBe("");
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: "sk-rotated-key-0000abcd" });
    expect(resolveEffective(loadAuth(h.imagesDir), p.data.id)?.apiKey).toBe("sk-rotated-key-0000abcd");
    await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
  });
});
