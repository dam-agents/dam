import { globSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const include = ["src/__tests__/unit/**/*.test.ts", "src/modules/**/*.test.ts"];
const mocking = globSync(include).filter((f) =>
  /vi\.(mock|stubGlobal)\(/.test(readFileSync(f, "utf8")),
);

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "shared", include, exclude: mocking, isolate: false },
      },
      { extends: true, test: { name: "isolated", include: mocking } },
    ],
  },
});
