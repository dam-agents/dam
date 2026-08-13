import { defineConfig } from "vitest/config";

// Separate from the unit config: these tests drive a real container, so they are
// opt-in (`mise run agent-runtime:test:proc`) and need a sweep-interval budget.
export default defineConfig({
  test: {
    include: ["src/__tests__/proc/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
