import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/global-setup.ts"],
    fileParallelism: false,
  },
});
