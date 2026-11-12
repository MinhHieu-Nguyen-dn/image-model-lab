/** API tests: like/dislike ratings on run images and the cross-run image history with per-model counts. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, setupTask, type Harness } from "./helpers/test-harness.ts";

let h: Harness;
const FAST = ["qwen-image-3.0", "qwen-image-3.0-pro"];

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function runOnce(tid: string, models = FAST) {
  const post = await h.api("POST", `/api/tasks/${tid}/runs`, { models });
  return h.waitForRun(post.data.id);
}
const rate = (rid: string, modelKey: string, idx: number, rating: unknown) =>
  h.api("PUT", `/api/runs/${rid}/results/${modelKey}/images/${idx}/rating`, { rating });

describe("image ratings", () => {
  test("like, switch to dislike and clear; the run reflects it per image", async () => {
    const { tid } = await setupTask(h);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "x", size: "512*512", n: 2 });
    const run = await runOnce(tid);

    expect((await rate(run.id, "qwen-image-3.0", 1, "like")).data).toMatchObject({ rating: "like", imageIndex: 1 });
    let got = (await h.api("GET", `/api/runs/${run.id}`)).data;
    const first = got.results.find((r: any) => r.modelKey === "qwen-image-3.0");
    expect(first.images[0].rating).toBeUndefined();
    expect(first.images[1].rating).toBe("like");

    await rate(run.id, "qwen-image-3.0", 1, "dislike");
    got = (await h.api("GET", `/api/tasks/${tid}/runs`)).data[0];
    expect(got.results.find((r: any) => r.modelKey === "qwen-image-3.0").images[1].rating).toBe("dislike");

    expect((await rate(run.id, "qwen-image-3.0", 1, null)).data.rating).toBeNull();
    got = (await h.api("GET", `/api/runs/${run.id}`)).data;
    expect(got.results.every((r: any) => r.images.every((i: any) => i.rating === undefined))).toBe(true);
  });

  test("rejects unknown runs, models, image indexes and bad ratings", async () => {
    const { tid } = await setupTask(h);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "x", size: "512*512", n: 1 });
    const run = await runOnce(tid);
    expect((await rate("r_nope", "qwen-image-3.0", 0, "like")).status).toBe(404);
    expect((await rate(run.id, "nope-model", 0, "like")).status).toBe(404);
    expect((await rate(run.id, "qwen-image-3.0", 5, "like")).status).toBe(404);
    expect((await rate(run.id, "qwen-image-3.0", "x" as any, "like")).status).toBe(404);
    expect((await rate(run.id, "qwen-image-3.0", 0, "love")).status).toBe(400);
    expect((await h.api("PUT", `/api/runs/${run.id}/results/qwen-image-3.0/images/0/rating`, {})).status).toBe(400);
  });

  test("deleting the task removes its ratings from the history", async () => {
    const { pid, tid } = await setupTask(h);
    await h.api("PATCH", `/api/tasks/${tid}`, { prompt: "x", size: "512*512", n: 1 });
    const run = await runOnce(tid, ["qwen-image-3.0"]);
    await rate(run.id, "qwen-image-3.0", 0, "like");
    const before = (await h.api("GET", `/api/history?projectId=${pid}`)).data;
    expect(before.images).toHaveLength(1);
    await h.api("DELETE", `/api/tasks/${tid}`);
    const after = (await h.api("GET", `/api/history?projectId=${pid}`)).data;
    expect(after.images).toHaveLength(0);
    expect(h.app.ctx.db.query("SELECT COUNT(*) AS n FROM image_ratings WHERE run_id = ?").get(run.id)).toEqual({ n: 0 });
  });
});

describe("image history", () => {
  test("lists all images with source info and filters by project, model and rating with per-model counts", async () => {
    const a = await setupTask(h);
    const b = await setupTask(h);
    for (const t of [a.tid, b.tid]) await h.api("PATCH", `/api/tasks/${t}`, { prompt: "x", size: "512*512", n: 2 });
    const runA = await runOnce(a.tid);
    const runB = await runOnce(b.tid, ["qwen-image-3.0"]);

    await rate(runA.id, "qwen-image-3.0", 0, "like");
    await rate(runA.id, "qwen-image-3.0", 1, "dislike");
    await rate(runA.id, "qwen-image-3.0-pro", 0, "like");
    await rate(runB.id, "qwen-image-3.0", 0, "like");

    const inA = (await h.api("GET", `/api/history?projectId=${a.pid}`)).data;
    expect(inA.images).toHaveLength(4);
    expect(inA.images[0]).toMatchObject({ runId: runA.id, taskId: a.tid, projectId: a.pid });
    expect(inA.images[0].image.url).toContain("/files/");
    expect(inA.projects.map((p: any) => p.id)).toEqual(expect.arrayContaining([a.pid, b.pid]));
    const sumA = Object.fromEntries(inA.models.map((m: any) => [m.modelKey, m]));
    expect(sumA["qwen-image-3.0"]).toMatchObject({ images: 2, likes: 1, dislikes: 1, unrated: 0 });
    expect(sumA["qwen-image-3.0-pro"]).toMatchObject({ images: 2, likes: 1, dislikes: 0, unrated: 1 });

    // Model filter narrows images but the summary still lists every model of the project.
    const model = (await h.api("GET", `/api/history?projectId=${a.pid}&model=qwen-image-3.0`)).data;
    expect(model.images).toHaveLength(2);
    expect(model.images.every((i: any) => i.modelKey === "qwen-image-3.0")).toBe(true);
    expect(model.models).toHaveLength(2);

    // Rating filter: counts by model stay available.
    const liked = (await h.api("GET", `/api/history?projectId=${a.pid}&rating=like`)).data;
    expect(liked.images).toHaveLength(2);
    expect(liked.images.every((i: any) => i.image.rating === "like")).toBe(true);
    const unrated = (await h.api("GET", `/api/history?projectId=${a.pid}&rating=unrated`)).data;
    expect(unrated.images).toHaveLength(1);
    expect(unrated.images[0]).toMatchObject({ modelKey: "qwen-image-3.0-pro", imageIndex: 1 });
    const disliked = (await h.api("GET", `/api/history?projectId=${a.pid}&model=qwen-image-3.0&rating=dislike`)).data;
    expect(disliked.images).toHaveLength(1);

    // Without a project filter both projects are included.
    const all = (await h.api("GET", `/api/history?model=qwen-image-3.0`)).data;
    expect(all.images.length).toBeGreaterThanOrEqual(4);
    expect((await h.api("GET", "/api/history?rating=love")).status).toBe(400);
  });

  test("filters by task and prompt_extend, and splits each model's counts by prompt_extend", async () => {
    const a = await setupTask(h);
    const second = (await h.api("POST", `/api/projects/${a.pid}/tasks`, { name: "second" })).data.id;
    await h.api("PATCH", `/api/tasks/${a.tid}`, { prompt: "x", size: "512*512", n: 2, promptExtend: true });
    await h.api("PATCH", `/api/tasks/${second}`, { prompt: "y", size: "512*512", n: 1, promptExtend: false });
    const on = await runOnce(a.tid, ["qwen-image-3.0"]);
    const off = await runOnce(second, ["qwen-image-3.0"]);
    await h.api("PATCH", `/api/tasks/${second}`, { promptExtend: true });
    await runOnce(second, ["qwen-image-3.0"]);
    await rate(on.id, "qwen-image-3.0", 0, "like");
    await rate(off.id, "qwen-image-3.0", 0, "dislike");

    const base = `/api/history?projectId=${a.pid}`;
    const all = (await h.api("GET", base)).data;
    expect(all.images).toHaveLength(4);
    expect(all.tasks.map((t: any) => t.id).sort()).toEqual([a.tid, second].sort());

    // Task filter narrows images and the summary.
    const byTask = (await h.api("GET", `${base}&taskId=${second}`)).data;
    expect(byTask.images).toHaveLength(2);
    expect(byTask.images.every((i: any) => i.taskId === second)).toBe(true);
    expect(byTask.models[0].images).toBe(2);
    expect(byTask.tasks).toHaveLength(2);

    // prompt_extend narrows images only; the summary keeps both halves of the split.
    const extOn = (await h.api("GET", `${base}&promptExtend=true`)).data;
    expect(extOn.images).toHaveLength(3);
    const extOff = (await h.api("GET", `${base}&promptExtend=false`)).data;
    expect(extOff.images).toHaveLength(1);
    expect(extOff.images[0]).toMatchObject({ runId: off.id, image: { rating: "dislike" } });
    const m = extOff.models[0];
    expect(m).toMatchObject({ images: 4, likes: 1, dislikes: 1, unrated: 2 });
    expect(m.promptExtend.on).toMatchObject({ images: 3, likes: 1, dislikes: 0, unrated: 2 });
    expect(m.promptExtend.off).toMatchObject({ images: 1, likes: 0, dislikes: 1, unrated: 0 });

    expect((await h.api("GET", `${base}&promptExtend=maybe`)).status).toBe(400);
  });

  test("accepts several projects and several tasks", async () => {
    const a = await setupTask(h);
    const b = await setupTask(h);
    const c = await setupTask(h);
    const second = (await h.api("POST", `/api/projects/${a.pid}/tasks`, { name: "second" })).data.id;
    for (const t of [a.tid, b.tid, c.tid, second]) await h.api("PATCH", `/api/tasks/${t}`, { prompt: "x", size: "512*512", n: 1 });
    for (const t of [a.tid, b.tid, c.tid, second]) await runOnce(t, ["qwen-image-3.0"]);

    const count = async (query: string) => (await h.api("GET", `/api/history?${query}`)).data;

    // Several projects: images, summary and task list cover exactly those projects.
    const twoProjects = await count(`projectId=${a.pid}&projectId=${b.pid}`);
    expect(twoProjects.images.map((i: any) => i.projectId).sort()).toEqual([a.pid, a.pid, b.pid].sort());
    expect(twoProjects.models[0].images).toBe(3);
    expect(twoProjects.tasks.map((t: any) => t.id).sort()).toEqual([a.tid, second, b.tid].sort());
    expect(twoProjects.projects.map((p: any) => p.id)).toEqual(expect.arrayContaining([a.pid, b.pid, c.pid]));

    // Several tasks, across projects.
    const tasks = await count(`taskId=${second}&taskId=${c.tid}`);
    expect(tasks.images.map((i: any) => i.taskId).sort()).toEqual([second, c.tid].sort());
    expect(tasks.models[0].images).toBe(2);

    // Project and task together intersect.
    const both = await count(`projectId=${a.pid}&projectId=${b.pid}&taskId=${second}&taskId=${c.tid}`);
    expect(both.images.map((i: any) => i.taskId)).toEqual([second]);

    // A single value and empty values behave as before.
    expect((await count(`projectId=${c.pid}&taskId=`)).images).toHaveLength(1);
  });

  test("downloads the filtered images as a ZIP", async () => {
    const a = await setupTask(h);
    const b = await setupTask(h);
    for (const t of [a.tid, b.tid]) await h.api("PATCH", `/api/tasks/${t}`, { prompt: "x", size: "512*512", n: 2 });
    const runA = await runOnce(a.tid, ["qwen-image-3.0"]);
    await runOnce(b.tid, ["qwen-image-3.0"]);
    await rate(runA.id, "qwen-image-3.0", 1, "like");

    const fetchZip = async (query: string) => {
      const res = await fetch(`${h.app.url}/api/history/download?${query}`);
      return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
    };
    /** Reads the stored entries from the central directory: name -> bytes. */
    const unzip = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const eocd = bytes.length - 22;
      expect(view.getUint32(eocd, true)).toBe(0x06054b50);
      const out = new Map<string, Uint8Array>();
      let pos = view.getUint32(eocd + 16, true);
      for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
        expect(view.getUint32(pos, true)).toBe(0x02014b50);
        const size = view.getUint32(pos + 24, true);
        const nameLen = view.getUint16(pos + 28, true);
        const local = view.getUint32(pos + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + size);
        expect(Bun.hash.crc32(data)).toBe(view.getUint32(pos + 16, true));
        out.set(name, data);
        pos += 46 + nameLen;
      }
      return out;
    };

    // Everything in scope: both tasks, two images each, with the exact image bytes.
    const inA = await fetchZip(`projectId=${a.pid}`);
    expect(inA.res.status).toBe(200);
    expect(inA.res.headers.get("content-type")).toBe("application/zip");
    expect(inA.res.headers.get("content-disposition")).toMatch(/^attachment; filename="history-images-\d{8}-\d{6}\.zip"$/);
    const filesA = unzip(inA.bytes);
    expect([...filesA.keys()].every((n) => n.split("/").length === 3)).toBe(true); // project/task/file
    expect([...filesA.keys()].map((n) => n.split("/").pop()).sort()).toEqual([`${runA.id}_qwen-image-3.0-1.png`, `${runA.id}_qwen-image-3.0-2.png`]);
    expect(filesA.size).toBe(2);
    const listed = (await h.api("GET", `/api/history?projectId=${a.pid}`)).data.images;
    for (const item of listed) {
      const original = new Uint8Array(await (await fetch(`${h.app.url}${item.image.url}`)).arrayBuffer());
      const entry = [...filesA].find(([name]) => name.endsWith(`${item.runId}_${item.modelKey}-${item.imageIndex + 1}.png`));
      expect(entry?.[1]).toEqual(original);
    }

    // Only the images satisfying the filters are archived.
    const liked = unzip((await fetchZip(`projectId=${a.pid}&rating=like`)).bytes);
    expect([...liked.keys()].map((n) => n.split("/").pop())).toEqual([`${runA.id}_qwen-image-3.0-2.png`]);
    const both = unzip((await fetchZip(`projectId=${a.pid}&projectId=${b.pid}`)).bytes);
    expect(both.size).toBe(4);

    // Nothing matches: a clear error rather than an empty archive; bad filters are rejected.
    expect((await fetchZip(`projectId=${a.pid}&rating=dislike`)).res.status).toBe(404);
    expect((await fetchZip("rating=love")).res.status).toBe(400);
  });
});
