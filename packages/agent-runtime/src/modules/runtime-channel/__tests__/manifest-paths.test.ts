import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harnessManifestPaths } from "../manifest-paths.js";

/**
 * TEST_OVERVIEW: the runtime finds every harness's runtime manifest beside its
 * own directory: one per harness under `runtime-manifests/` when the Agent's
 * harness has one there, else the image's single `runtime-manifest.yaml`.
 */
describe("harnessManifestPaths", () => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-paths-"));
  afterEach(() =>
    rmSync(join(dir, "runtime-manifests"), { recursive: true, force: true }),
  );

  /**
   * TEST_SCENARIO: the default image ships a manifest per harness, so every
   * one is named after its harness and files that are not YAML are skipped.
   */
  it("should name every harness's manifest when the Agent's harness has one", () => {
    mkdirSync(join(dir, "runtime-manifests"));
    for (const f of ["claude-code.yaml", "codex.yaml", "README"]) {
      writeFileSync(join(dir, "runtime-manifests", f), "");
    }
    expect(harnessManifestPaths(dir, "codex")).toEqual({
      "claude-code": join(dir, "runtime-manifests", "claude-code.yaml"),
      codex: join(dir, "runtime-manifests", "codex.yaml"),
    });
  });

  /**
   * TEST_SCENARIO: an image with no manifest for the Agent's harness under
   * `runtime-manifests/` runs that harness on its single manifest.
   */
  it("should fall back to the single manifest for any other harness", () => {
    mkdirSync(join(dir, "runtime-manifests"));
    writeFileSync(join(dir, "runtime-manifests", "codex.yaml"), "");
    expect(harnessManifestPaths(dir, "mock")).toEqual({
      mock: join(dir, "runtime-manifest.yaml"),
    });
  });
});
