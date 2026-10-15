import { replaceEqualDeep } from "@tanstack/react-query";
import type { FileDiff } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { fileDiffData } from "../../modules/changes/lib/diff-layout.js";

// TEST_OVERVIEW: the data the Changes panel hands each diff view — it stays the same object while the file is unchanged, so a chat update or a watch refetch does not make every diff re-parse and re-highlight.

function file(path: string, patch: string): FileDiff {
  return {
    path,
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    uncommitted: false,
    patch,
  };
}

describe("file diff data", () => {
  // TEST_SCENARIO: a re-render passes the same file again; the diff view gets the same data and keeps what it already drew.
  it("hands the same data for the same file", () => {
    const a = file("a.ts", "@@ -1 +1 @@\n-a\n+b\n");

    expect(fileDiffData(a)).toBe(fileDiffData(a));
    expect(fileDiffData(a)).toEqual({
      oldFile: { fileName: "a.ts" },
      newFile: { fileName: "a.ts" },
      hunks: ["@@ -1 +1 @@\n-a\n+b\n"],
    });
  });

  // TEST_SCENARIO: a watch refetch returns an unchanged file and an edited one; only the edited file's diff view gets new data.
  it("hands new data only for the file a refetch changed", () => {
    const before = {
      files: [
        file("a.ts", "@@ -1 +1 @@\n-a\n+b\n"),
        file("b.ts", "@@ -1 +1 @@\n-c\n+d\n"),
      ],
    };
    const fetched = {
      files: [
        file("a.ts", "@@ -1 +1 @@\n-a\n+b\n"),
        file("b.ts", "@@ -1 +1 @@\n-c\n+e\n"),
      ],
    };
    const after = replaceEqualDeep(before, fetched);
    const [beforeA, beforeB] = before.files.map(fileDiffData);
    const [afterA, afterB] = after.files.map(fileDiffData);

    expect(afterA).toBe(beforeA);
    expect(afterB).not.toBe(beforeB);
    expect(afterB?.hunks).toEqual(["@@ -1 +1 @@\n-c\n+e\n"]);
  });

  // TEST_SCENARIO: a renamed file names its old path on the old side.
  it("names a renamed file's old path", () => {
    const renamed = {
      ...file("b.ts", "@@ -1 +1 @@\n-a\n+b\n"),
      oldPath: "a.ts",
    };

    expect(fileDiffData(renamed).oldFile.fileName).toBe("a.ts");
    expect(fileDiffData(renamed).newFile.fileName).toBe("b.ts");
  });
});
