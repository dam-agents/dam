import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/__tests__/unit/**/*.test.ts"],
    environment: "node",
  },
});
