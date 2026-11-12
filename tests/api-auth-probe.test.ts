/** API tests: credential save/test probe outcomes, mode 0600, masking, project override. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, MOCK_GOOD_KEY, type Harness } from "./helpers/test-harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("credentials + probe", () => {
  test("PUT global saves with mode 600, masks key and probes ok (no generation)", async () => {
    h.mock.requests.length = 0;
    const res = await h.api("PUT", "/api/credentials", { endpoint: h.mock.url, apiKey: MOCK_GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.data.saved).toBe(true);
    expect(res.data.test).toMatchObject({ ok: true, kind: "ok", httpStatus: 400 });
    expect(typeof res.data.test.latencyMs).toBe("number");
    expect(res.data.credentials.global).toEqual({ endpoint: `${h.mock.url}/api/v1/services/aigc/multimodal-generation/generation`, apiKeyMasked: "****", hasKey: true });
    expect(statSync(join(h.imagesDir, "credentials.json")).mode & 0o777).toBe(0o600);
    // The probe reached the mock but was rejected as incomplete: nothing generated.
    expect(h.mock.requests.map((r) => r.status)).toEqual([400]);
  });

  test("bad key -> invalid_key", async () => {
    const res = await h.api("POST", "/api/credentials/test", { apiKey: "sk-wrongwrongwrong1234" });
    expect(res.data).toMatchObject({ ok: false, kind: "invalid_key", httpStatus: 401 });
  });

  test("wrong path -> wrong_path", async () => {
    const res = await h.api("POST", "/api/credentials/test", { endpoint: `${h.mock.url}/api/v9/nope` });
    expect(res.data).toMatchObject({ ok: false, kind: "wrong_path", httpStatus: 404 });
  });

  test("unknown model id (404 'Model not exist') is not reported as a wrong path", async () => {
    const cat = (await h.api("GET", "/api/catalog")).data;
    cat.models[0].apiModel = "model-ghost";
    expect((await h.api("PUT", "/api/catalog", cat)).status).toBe(200);
    const res = await h.api("POST", "/api/credentials/test", { endpoint: h.mock.url });
    expect(res.data).toMatchObject({ ok: true, kind: "ok", httpStatus: 404 });
    expect(res.data.message).toContain("model-ghost");
    cat.models[0].apiModel = cat.models[0].key;
    await h.api("PUT", "/api/catalog", cat);
  });

  test("a rate-limited probe (429 after auth) still proves host, path and key", async () => {
    const cat = (await h.api("GET", "/api/catalog")).data;
    const original = cat.models[0].apiModel;
    cat.models[0].apiModel = "model-ratelimit";
    expect((await h.api("PUT", "/api/catalog", cat)).status).toBe(200);
    const res = await h.api("POST", "/api/credentials/test", { endpoint: h.mock.url });
    expect(res.data).toMatchObject({ ok: true, kind: "ok", httpStatus: 429 });
    expect(res.data.message).toContain("rate-limited");
    cat.models[0].apiModel = original;
    await h.api("PUT", "/api/catalog", cat);
  });

  test("an endpoint stored as a bare base URL is completed when read", async () => {
    const file = join(h.imagesDir, "credentials.json");
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.global.endpoint = `${h.mock.url}/api/v1`;
    writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
    const res = await h.api("POST", "/api/credentials/test", {});
    expect(res.data).toMatchObject({ ok: true, kind: "ok" });
  });

  test("closed port -> unreachable", async () => {
    const res = await h.api("POST", "/api/credentials/test", { endpoint: "http://127.0.0.1:1", apiKey: MOCK_GOOD_KEY });
    expect(res.data).toMatchObject({ ok: false, kind: "unreachable" });
  });

  test("PUT without apiKey keeps the stored key", async () => {
    const res = await h.api("PUT", "/api/credentials", { endpoint: h.mock.url });
    expect(res.data.credentials.global.hasKey).toBe(true);
    expect(res.data.test.kind).toBe("ok");
  });

  test("invalid endpoint -> 400", async () => {
    const res = await h.api("PUT", "/api/credentials", { endpoint: "ftp://x" });
    expect(res.status).toBe(400);
    expect(typeof res.data.error).toBe("string");
  });

  test("project override is effective over global; DELETE restores global", async () => {
    const p = await h.api("POST", "/api/projects", { name: "override" });
    const pid = p.data.id;
    const put = await h.api("PUT", `/api/projects/${pid}/credentials`, { endpoint: h.mock.url, apiKey: "sk-projectkey-0000abcd" });
    expect(put.data.test.kind).toBe("invalid_key");
    expect(put.data.credentials.effective).toMatchObject({ source: "project", apiKeyMasked: "sk-****abcd" });
    expect((await h.api("GET", "/api/credentials")).data.effective.source).toBe("global");
    const del = await h.api("DELETE", `/api/projects/${pid}/credentials`);
    expect(del.data.project).toBeNull();
    expect(del.data.effective.source).toBe("global");
    expect(statSync(join(h.imagesDir, "credentials.json")).mode & 0o777).toBe(0o600);
  });

  test("no response ever contained a full API key", () => {
    for (const body of h.responses) {
      expect(body).not.toContain(MOCK_GOOD_KEY);
      expect(body).not.toContain("sk-projectkey-0000abcd");
      expect(body).not.toContain("sk-wrongwrongwrong1234");
    }
  });
});
