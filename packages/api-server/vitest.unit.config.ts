import { globSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const include = ["src/__tests__/unit/**/*.test.ts"];
const mocking = globSync(include).filter((f) =>
  readFileSync(f, "utf8").includes("vi.mock("),
);

// UNIT_BOUNDARY_DESCRIPTION: Runs unit files without per-file isolation, since re-importing the module graph for every file was most of the suite's time. A worker then shares one module registry across files, so a vi.mock comes too late once another file loaded the real module: files that call vi.mock keep their isolation.
export default defineConfig({
  test: {
    setupFiles: ["src/install-temporal.ts"],
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: { name: "shared", include, exclude: mocking, isolate: false },
      },
      { extends: true, test: { name: "isolated", include: mocking } },
    ],
  },
});
