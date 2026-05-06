import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { compose } from "../modules/cli/compose.js";

describe("cli scaffold", () => {
  it("compose() returns a program named `dam` at the package.json version", () => {
    const program = compose();
    expect(program.name()).toBe("dam");

    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(resolve(here, "../../package.json"), "utf-8"),
    ) as { version: string };
    expect(program.version()).toBe(pkg.version);
  });
});
