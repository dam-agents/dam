import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesService } from "../../modules/files.js";

// TEST_OVERVIEW: The files panel lists, creates and renames workspace entries through the files service. The service must report a symlinked folder as a folder, must refuse a folder name that is already taken, and must answer a failed rename with a message that names only workspace-relative paths, because the UI shows these results to the user as they are.

describe("files service edge cases", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "files-edges-"));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const service = () => createFilesService(work);
  const list = async (rel: string) => {
    const [result] = await service().listDirs([rel]);
    if (!result.ok) throw new Error(`list failed: ${result.error}`);
    return result.entries;
  };

  // TEST_SCENARIO: A symlink to a folder, like home's `.cache`, lists as a folder and lists the target's entries when expanded; a dangling link stays a file.
  it("lists a symlinked folder as a folder and a broken link as a file", async () => {
    mkdirSync(join(work, "real"));
    writeFileSync(join(work, "real", "inside.txt"), "x");
    symlinkSync(join(work, "real"), join(work, "linkdir"));
    symlinkSync(join(work, "missing"), join(work, "dangling"));

    expect(await list("")).toEqual([
      { name: "linkdir", type: "dir" },
      { name: "real", type: "dir" },
      { name: "dangling", type: "file" },
    ]);
    expect(await list("linkdir")).toEqual([
      { name: "inside.txt", type: "file" },
    ]);
  });

  // TEST_SCENARIO: Creating a folder whose name is taken by a folder is a conflict, not a silent success.
  it("refuses to create a folder that already exists", async () => {
    mkdirSync(join(work, "taken"));

    const result = await service().mkdirSafe("taken");

    expect(result).toEqual({
      ok: false,
      error: { kind: "AlreadyExists", path: "taken" },
    });
  });

  // TEST_SCENARIO: Renaming a folder to a path inside itself is refused with a relative-path message and leaves no stray folder behind.
  it("refuses to move a folder into itself", async () => {
    mkdirSync(join(work, "données"));

    const result = await service().renameSafe(
      "données",
      "données/inside/deeper",
      false,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("Forbidden");
    expect(JSON.stringify(result.error)).not.toContain(work);
    expect(existsSync(join(work, "données", "inside"))).toBe(false);
  });

  // TEST_SCENARIO: A rename the filesystem rejects for another reason answers with the relative paths and the error code, never the absolute pod path.
  it("reports an unmapped rename failure without absolute paths", async () => {
    const result = await service().renameSafe("ghost", "elsewhere", false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "Forbidden",
      reason: `can't move "ghost" to "elsewhere" (ENOENT)`,
    });
  });
});
