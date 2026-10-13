import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf-8"),
) as { version: string };

// TEST_OVERVIEW: the tests clear the proxy variables around each in-process CLI call. Node's built-in env proxy keeps the proxy it read at startup but re-reads NO_PROXY per request, so with it on, requests to the tests' own loopback servers go to the proxy. The forked test workers inherit this process's env, so they run without it, as CI does.
delete process.env.NODE_USE_ENV_PROXY;

export default defineConfig({
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/global-setup.ts"],
    fileParallelism: false,
    // TEST_OVERVIEW: some tests drive the built CLI as a real subprocess, so the 5s vitest default sits inside the noise band of a loaded CI runner.
    testTimeout: 30_000,
  },
});
