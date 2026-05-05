import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFile } from "../../modules/pod-files/apply.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pod-files-apply-"));
}

/**
 * applyFile's only platform-specific responsibility is the path-access guard:
 * incoming FileSpecs from the api-server must resolve under agentHome or
 * the write is refused. The merge semantics are covered in merge tests;
 * the happy-path write end-to-end is covered through the dispatch test.
 */
describe("applyFile path access", () => {
  it.each([
    ["absolute outside home", () => ({ home: tmp(), path: join(tmp(), "evil.yml") })],
    [
      "traversal back out of home",
      () => {
        const home = tmp();
        const other = tmp();
        return { home, path: join(home, "..", other.split("/").pop()!, "evil.yml") };
      },
    ],
    ["sibling-prefix trick (homeX/...)", () => {
      const home = tmp();
      return { home, path: home + "X/evil.yml" };
    }],
  ])("rejects path %s and writes nothing", (_label, mk) => {
    const { home, path } = mk();
    expect(() =>
      applyFile(
        { path, mode: "yaml-fill-if-missing", fragments: [{ k: "v" }] },
        home,
      ),
    ).toThrow(/refusing to write/);
    expect(existsSync(path)).toBe(false);
  });

  it("rejects writing to home itself (would replace the directory)", () => {
    const home = tmp();
    expect(() =>
      applyFile(
        { path: home, mode: "yaml-fill-if-missing", fragments: [{ k: "v" }] },
        home,
      ),
    ).toThrow(/refusing to write/);
    expect(statSync(home).isDirectory()).toBe(true);
  });
});
