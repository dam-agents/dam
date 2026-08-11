import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two homes: the original central suite, and co-located tests that sit
    // next to the module they specify (see modules/acp/services/acp-runtime).
    include: ["src/__tests__/unit/**/*.test.ts", "src/modules/**/*.test.ts"],
  },
});
