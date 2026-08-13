import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/proc/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
