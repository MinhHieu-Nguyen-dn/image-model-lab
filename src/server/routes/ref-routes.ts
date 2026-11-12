/**
 * Reference image endpoints. Upload returns the new ref (201); reorder and delete
 * return the updated task so the client gets the renumbered list in one call.
 */
import { HttpError, json, readJsonObject } from "../http-utils.ts";
import type { Router } from "../router.ts";
import { getTask } from "../project-task-store.ts";
import { addRef, deleteRef, MAX_UPLOAD_BYTES, reorderRefs } from "../ref-store.ts";

export function registerRefRoutes(router: Router): void {
  router
    .add("POST", "/api/tasks/:tid/refs", async (req, p, ctx) => {
      const task = getTask(ctx, p.tid);
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) throw new HttpError(413, `Reference image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new HttpError(400, "Expected multipart/form-data with a 'file' field");
      }
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Missing 'file' field");
      return json(await addRef(ctx, task.projectId, task.id, file), 201);
    })
    .add("PUT", "/api/tasks/:tid/refs/order", async (req, p, ctx) => {
      getTask(ctx, p.tid);
      reorderRefs(ctx, p.tid, (await readJsonObject(req)).ids);
      return json(getTask(ctx, p.tid));
    })
    .add("DELETE", "/api/tasks/:tid/refs/:refId", (_req, p, ctx) => {
      getTask(ctx, p.tid);
      deleteRef(ctx, p.tid, p.refId);
      return json(getTask(ctx, p.tid));
    });
}
