import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/global-setup.ts"],
    fileParallelism: false,
    // TEST_OVERVIEW: these tests drive the built CLI as a real subprocess, several per test, so the 5s vitest default sits inside the noise band of a loaded CI runner.
    testTimeout: 30_000,
  },
});
