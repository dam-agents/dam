import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { finalize } from "../../modules/import/finalize.js";

let staging: string;
let dest: string;

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), "finalize-staging-"));
  dest = mkdtempSync(join(tmpdir(), "finalize-dest-"));
});

afterEach(() => {
  rmSync(staging, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

describe("finalize", () => {
  it("replace mode rewrites top-level entries that already existed", async () => {
    writeFileSync(join(dest, "CLAUDE.md"), "old");
    mkdirSync(join(dest, ".claude"));
    writeFileSync(join(dest, ".claude/settings.json"), "{\"old\":true}");
    writeFileSync(join(dest, "untouched.txt"), "keep me");

    writeFileSync(join(staging, "CLAUDE.md"), "new");
    mkdirSync(join(staging, ".claude"));
    writeFileSync(join(staging, ".claude/settings.json"), "{\"new\":true}");

    const result = await finalize(staging, dest, "", "replace");
    expect(result.ok).toBe(true);

    expect(readFileSync(join(dest, "CLAUDE.md"), "utf8")).toBe("new");
    expect(readFileSync(join(dest, ".claude/settings.json"), "utf8")).toBe("{\"new\":true}");
    // Files outside the bundle's top-level set survive replace mode.
    expect(readFileSync(join(dest, "untouched.txt"), "utf8")).toBe("keep me");
  });

  it("merge mode overwrites same-path files and keeps disjoint ones", async () => {
    mkdirSync(join(dest, ".claude"));
    writeFileSync(join(dest, ".claude/settings.json"), "{\"old\":true}");
    writeFileSync(join(dest, ".claude/keep.txt"), "kept");

    mkdirSync(join(staging, ".claude"));
    writeFileSync(join(staging, ".claude/settings.json"), "{\"new\":true}");
    writeFileSync(join(staging, ".claude/added.txt"), "added");

    const result = await finalize(staging, dest, "", "merge");
    expect(result.ok).toBe(true);

    expect(readFileSync(join(dest, ".claude/settings.json"), "utf8")).toBe("{\"new\":true}");
    expect(readFileSync(join(dest, ".claude/keep.txt"), "utf8")).toBe("kept");
    expect(readFileSync(join(dest, ".claude/added.txt"), "utf8")).toBe("added");
  });

  it("merge mode does not follow a pre-existing symlink at the destination", async () => {
    // Plant an adversarial symlink: `dest/.claude` points outside `dest`.
    const elsewhere = mkdtempSync(join(tmpdir(), "finalize-elsewhere-"));
    try {
      symlinkSync(elsewhere, join(dest, ".claude"));

      mkdirSync(join(staging, ".claude"));
      writeFileSync(join(staging, ".claude/settings.json"), "{\"new\":true}");

      const result = await finalize(staging, dest, "", "merge");
      expect(result.ok).toBe(true);

      // The bundle's `.claude/` must land *under dest*, not inside the symlink
      // target. So `elsewhere` stays empty…
      expect(existsSync(join(elsewhere, "settings.json"))).toBe(false);
      // …and `dest/.claude` is now a directory, not the symlink anymore.
      expect(readFileSync(join(dest, ".claude/settings.json"), "utf8")).toBe("{\"new\":true}");
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("merge mode replaces a destination symlink-to-file with the bundle file", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "finalize-elsewhere-"));
    try {
      writeFileSync(join(elsewhere, "real.txt"), "outside");
      symlinkSync(join(elsewhere, "real.txt"), join(dest, "alias"));

      writeFileSync(join(staging, "alias"), "new");

      const result = await finalize(staging, dest, "", "merge");
      expect(result.ok).toBe(true);

      // The symlink target file is left untouched outside dest.
      expect(readFileSync(join(elsewhere, "real.txt"), "utf8")).toBe("outside");
      // `dest/alias` is now a regular file with the bundle's content.
      expect(readFileSync(join(dest, "alias"), "utf8")).toBe("new");
      expect(() => readlinkSync(join(dest, "alias"))).toThrow();
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("returns PrefixEscape for prefix=..", async () => {
    writeFileSync(join(staging, "x.txt"), "x");
    const result = await finalize(staging, dest, "..", "replace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("PrefixEscape");
  });

  it("returns PrefixEscape for prefix that climbs out via ../sibling", async () => {
    writeFileSync(join(staging, "x.txt"), "x");
    const result = await finalize(staging, dest, "../sibling", "replace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("PrefixEscape");
  });

  it("applies the bundle under a nested prefix and creates it if missing", async () => {
    writeFileSync(join(staging, "note.md"), "hi");
    const result = await finalize(staging, dest, "nested/path", "merge");
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dest, "nested/path/note.md"), "utf8")).toBe("hi");
  });
});
