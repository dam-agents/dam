import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preflight } from "../../modules/import/preflight.js";

let dest: string;

beforeEach(() => {
  dest = mkdtempSync(join(tmpdir(), "preflight-dest-"));
});

afterEach(() => {
  rmSync(dest, { recursive: true, force: true });
});

describe("preflight", () => {
  it("reports existing top-level paths as conflicts", async () => {
    writeFileSync(join(dest, "CLAUDE.md"), "x");
    mkdirSync(join(dest, ".claude"));

    const result = await preflight(["CLAUDE.md", ".claude", "fresh.md"], dest, "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.conflicts.sort()).toEqual([".claude", "CLAUDE.md"]);
  });

  it("returns no conflicts when target prefix is empty", async () => {
    const result = await preflight(["fresh"], dest, "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.conflicts).toEqual([]);
  });

  it("rejects prefix that climbs out of dest", async () => {
    const result = await preflight(["x"], dest, "..");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("PrefixEscape");
  });

  it("rejects non-top-level paths in the input list", async () => {
    const result = await preflight(["nested/file"], dest, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("NonTopLevelPath");
      if (result.error.kind === "NonTopLevelPath") expect(result.error.path).toBe("nested/file");
    }
  });

  it("rejects '.' and '..' as preflight inputs", async () => {
    for (const bad of [".", ".."]) {
      const result = await preflight([bad], dest, "");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("NonTopLevelPath");
    }
  });
});
