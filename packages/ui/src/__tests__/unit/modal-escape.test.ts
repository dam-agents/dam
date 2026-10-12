import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const src = fileURLToPath(new URL("../../", import.meta.url));

describe("Modal", () => {
  test("every <Modal> passes onClose, so Escape can close it", () => {
    const missing = globSync("**/*.tsx", { cwd: src }).flatMap((file) =>
      [...readFileSync(src + file, "utf8").matchAll(/<Modal\b([^>]*)>/g)]
        .filter(([, props]) => !props!.includes("onClose"))
        .map(() => file),
    );
    expect(missing).toEqual([]);
  });
});
