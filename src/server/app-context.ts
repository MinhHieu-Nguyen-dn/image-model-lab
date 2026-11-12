/** Shared per-app state passed to stores, runner and routes (no module-level singletons). */
import type { Database } from "bun:sqlite";

export interface AppContext {
  db: Database;
  /** Absolute path of the data directory (`./images` by default). */
  imagesDir: string;
  /** Absolute path of the static frontend directory (`./public`). */
  publicDir: string;
  /** In-flight background runs, awaited on shutdown and by tests. */
  pendingRuns: Set<Promise<void>>;
}
