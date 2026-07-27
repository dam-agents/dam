import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors vite.config.ts / tsconfig.json's `@` alias so a unit test can
  // import a module that itself imports via `@/...` (e.g. `@/lib/compact`).
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/__tests__/unit/**/*.test.ts"],
    environment: "node",
  },
});
