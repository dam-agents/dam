import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// TEST_OVERVIEW: the api-server owns the control tables, so nothing structural stops it from writing the ones the controller owns — only this guard does. It fails when api-server code imports the observation tables, so a status write has to arrive as a deliberate edit here rather than as a line in a diff nobody looked at twice.

const SOURCE_ROOT = new URL("../../", import.meta.url).pathname;

const CONTROLLER_OWNED = ["controlAgentStatus", "controlAgentConditions"];

const READ_ONLY_MODULE = /^control-read(-[a-z]+)*\.ts$/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .filter((entry) => !entry.parentPath.includes("__tests__"))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("api-server writes to controller-owned tables", () => {
  // TEST_SCENARIO: The observation tables belong to the controller, and the api-server reaches them — if at all — only through the read-only adapter named here. Any other file naming them is either a write or a second read path that skipped review.
  it("is confined to the read-only adapter", () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const named = CONTROLLER_OWNED.filter((table) => source.includes(table));
      if (named.length === 0) return [];
      if (READ_ONLY_MODULE.test(path)) return [];
      return [`${path.replace(SOURCE_ROOT, "")} names ${named.join(", ")}`];
    });

    expect(offenders).toEqual([]);
  });

  // TEST_SCENARIO: A guard that scans nothing passes for the wrong reason. The walker must find the module that does name the tables — the grant reconcile — so an empty file list is a failure, not a pass.
  it("scans files that do name control tables", () => {
    const names = sourceFiles(SOURCE_ROOT).filter((path) =>
      readFileSync(path, "utf8").includes("control.agents"),
    );

    expect(names.length).toBeGreaterThan(0);
  });
});
