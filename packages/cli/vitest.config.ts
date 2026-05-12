import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/global-setup.ts"],
    // The integration tests all build `dist/bin.js` and write to the
    // same temp `home`/`fixture` directories. Running them in parallel
    // workers races the tsup output and the harness state — keep test
    // files serial within this package. Tests inside a file still run
    // concurrently.
    fileParallelism: false,
  },
});
