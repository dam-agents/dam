// UNIT_BOUNDARY_DESCRIPTION: The image starts the agent-runtime here, and this file loads the server bundle after it turns on Node's compile cache and starts the session-history workers. Node compiles a module before any of its code runs, so the bundle cannot turn the cache on for itself. Only a vm Backend machine uses the cache: its root outlives a boot, so a cache next to the bundle saves about 100 ms on the next start, while a container's root is new on every start and writing the cache costs it about 60 ms. The cache is on for this process only: Node does not set NODE_COMPILE_CACHE for it, so a harness or a command the runtime starts compiles without it. The cache is written 30 s after the start, once the start's code has run: Node writes an entry only once, so a write right after the load would miss the functions the start compiles later (most of the saving), and a machine that powers off never lets Node write the cache at exit. A history worker spends most of a second on a vm machine importing its module, so it starts here, about 250 ms before the server bundle would have started it, and imports while the bundle loads. An Environment (PLATFORM_ENVIRONMENT_OF) runs no harness, so it starts none.
import { constants, enableCompileCache, flushCompileCache } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PLATFORM_BACKEND === "vm") {
  const cache = enableCompileCache(
    fileURLToPath(new URL("compile-cache", import.meta.url)),
  );
  if (cache.status === constants.compileCacheStatus.FAILED) {
    process.stderr.write(
      `[runtime] compile cache off: ${cache.message ?? "unknown error"}\n`,
    );
  }
}
const [{ harnessManifestPaths }, { prestartHistoryWorkers }] =
  await Promise.all([
    import("./modules/runtime-channel/manifest-paths.js"),
    import("./modules/acp/infrastructure/history-worker.js"),
  ]);
if (!process.env.PLATFORM_ENVIRONMENT_OF)
  prestartHistoryWorkers(
    Object.values(
      harnessManifestPaths(
        join(dirname(fileURLToPath(import.meta.url)), ".."),
        process.env.PLATFORM_HARNESS ?? "",
      ),
    ),
    (msg) => process.stderr.write(`[acp] ${msg}\n`),
  );
await import(new URL("server.js", import.meta.url).href);
setTimeout(flushCompileCache, 30_000).unref();
