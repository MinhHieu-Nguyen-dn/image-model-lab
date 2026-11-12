/** API tests: persistence across restart, file cleanup on delete, static/file serving safety. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { safeResolve } from "../src/server/paths.ts";
import { loadAuth } from "../src/server/model-studio-auth-store.ts";
import { createHarness, pngBytes, setupTask, type Harness } from "./helpers/test-harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("persistence and files", () => {
  test("projects, tasks, refs, runs and credentials survive restart", async () => {
    const { pid, tid } = await setupTask(h);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "persist me", seed: 5, promptExtend: true });
    await h.upload(tid, "r.png", pngBytes());
    const run = await h.waitForRun((await h.api("POST", `/api/tasks/${tid}/runs`, {})).data.id);
    expect(run.results[0].status).toBe("ok");

    await h.restart();
    expect((await h.api("GET", "/api/projects")).data.map((p: any) => p.id)).toContain(pid);
    const task = (await h.api("GET", `/api/tasks/${tid}`)).data;
    expect(task).toMatchObject({ prompt: "persist me", seed: 5, promptExtend: true, size: "1024*1024", n: 1 });
    expect(task.refs).toHaveLength(1);
    const runs = (await h.api("GET", `/api/tasks/${tid}/runs`)).data;
    expect(runs).toHaveLength(1);
    expect(runs[0].results[0].images[0].width).toBe(1024);
    expect((await h.api("GET", "/api/credentials")).data.global.hasKey).toBe(true);
  });

  test("deleting a task / project removes its files", async () => {
    const { pid, tid } = await setupTask(h);
    const ref = await h.upload(tid, "x.png", pngBytes());
    const taskPath = join(h.imagesDir, "projects", pid, "tasks", tid);
    expect(existsSync(join(taskPath, "refs"))).toBe(true);
    expect((await h.api("DELETE", `/api/tasks/${tid}`)).status).toBe(200);
    expect(existsSync(taskPath)).toBe(false);
    expect((await fetch(h.app.url + ref.data.url)).status).toBe(404);

    const t2 = (await h.api("POST", `/api/projects/${pid}/tasks`, { name: "t2" })).data;
    await h.upload(t2.id, "y.png", pngBytes());
    await h.api("PUT", `/api/projects/${pid}/credentials`, { endpoint: h.mock.url, apiKey: "sk-override-key-1234" });
    expect((await h.api("DELETE", `/api/projects/${pid}`)).status).toBe(200);
    expect(existsSync(join(h.imagesDir, "projects", pid))).toBe(false);
    expect((await h.api("GET", "/api/projects")).data.map((p: any) => p.id)).not.toContain(pid);
    expect((await h.api("GET", `/api/projects/${pid}/tasks`)).status).toBe(404);
    expect(loadAuth(h.imagesDir).projects[pid]).toBeUndefined();
  });

  test("ref upload rejects bad types and fake content", async () => {
    const { tid } = await setupTask(h);
    expect((await h.upload(tid, "x.txt", new TextEncoder().encode("hello"))).status).toBe(400);
    expect((await h.upload(tid, "fake.png", new TextEncoder().encode("not a png at all"))).status).toBe(400);
  });

  test("/files never exposes DB, credentials or traversal targets", async () => {
    for (const path of ["/files/credentials.json", "/files/studio.db", "/files/../package.json", "/files/%2e%2e/%2e%2e/etc/passwd", "/files/projects/..%2fcredentials.json"]) {
      // Clients normalise "/files/../x" to "/x", which then hits the public SPA fallback; never the target file.
      const res = await fetch(h.app.url + path);
      const body = await res.text();
      expect(res.status === 404 || body.includes("<title>studio</title>")).toBe(true);
      expect(body).not.toContain("apiKey");
      expect(body).not.toContain("root:");
      expect(body).not.toContain("SQLite format");
    }
    expect((await fetch(h.app.url + "/files/credentials.json")).status).toBe(404);
    expect(safeResolve(h.imagesDir, "../package.json")).toBeNull();
    expect(safeResolve(h.imagesDir, "projects/%2e%2e/%2e%2e/x")).toBeNull();
    expect(safeResolve(h.imagesDir, "projects/a%00b")).toBeNull();
  });

  test("public index served at / with SPA fallback; unknown api 404", async () => {
    expect(await (await fetch(h.app.url + "/")).text()).toContain("studio");
    expect(await (await fetch(h.app.url + "/some/route")).text()).toContain("studio");
    expect((await fetch(h.app.url + "/missing.js")).status).toBe(404);
    expect((await fetch(h.app.url + "/api/nope")).status).toBe(404);
  });
});
