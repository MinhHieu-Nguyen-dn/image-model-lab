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
});
