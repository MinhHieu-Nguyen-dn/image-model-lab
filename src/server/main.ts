/**
 * Entry point: `bun start` -> http://127.0.0.1:${PORT||4173}.
 * Env: PORT (default 4173), IMAGES_DIR (default ./images), PUBLIC_DIR (default ./public).
 */
import { startApp } from "./app.ts";

const rawPort = process.env.PORT ?? "4173";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${rawPort}`);
  process.exit(1);
}

const app = startApp({
  port,
  imagesDir: process.env.IMAGES_DIR || "images",
  publicDir: process.env.PUBLIC_DIR || "public",
});
console.log(`Image Model Lab running at ${app.url} (data: ${app.ctx.imagesDir})`);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Do not wait for long upstream calls on Ctrl+C; interrupted runs are recovered on next start.
  app.server.stop(true);
  app.ctx.db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
