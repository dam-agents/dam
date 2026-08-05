import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/integration/**/*.test.ts"],
    // First run may pull the postgres image.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
