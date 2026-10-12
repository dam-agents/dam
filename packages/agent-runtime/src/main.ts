// UNIT_BOUNDARY_DESCRIPTION: The image starts the agent-runtime here, and this file loads the server bundle after it turns on Node's compile cache. Node compiles a module before any of its code runs, so the bundle cannot turn the cache on for itself. Only a vm Backend machine uses the cache: its root outlives a boot, so a cache next to the bundle saves about 100 ms on the next start, while a container's root is new on every start and writing the cache costs it about 60 ms. The cache is on for this process only: Node does not set NODE_COMPILE_CACHE for it, so a harness or a command the runtime starts compiles without it. The cache is written as soon as the bundle has loaded, because a machine that powers off never lets Node write it at exit.
import { enableCompileCache, flushCompileCache } from "node:module";
import { fileURLToPath } from "node:url";

if (process.env.PLATFORM_BACKEND === "vm") {
  enableCompileCache(fileURLToPath(new URL("compile-cache", import.meta.url)));
}
await import(new URL("server.js", import.meta.url).href);
flushCompileCache();
