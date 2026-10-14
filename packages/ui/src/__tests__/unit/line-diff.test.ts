import { describe, expect, test } from "vitest";

import { collapseContext, diffLines } from "../../lib/line-diff.js";

describe("diffLines", () => {
  test("marks a changed line as removed then added, keeping the rest", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\n")).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
    ]);
  });

  test("a new file is all added lines", () => {
    expect(diffLines("", "x\ny")).toEqual([
      { kind: "added", text: "x" },
      { kind: "added", text: "y" },
    ]);
  });

  test("finds the common lines between scattered insertions and deletions", () => {
    expect(diffLines("a\nb\nc\nd", "a\nx\nc\nd\ne")).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "context", text: "c" },
      { kind: "context", text: "d" },
      { kind: "added", text: "e" },
    ]);
  });

  test("identical text has no changes", () => {
    expect(diffLines("same", "same")).toEqual([
      { kind: "context", text: "same" },
    ]);
  });
});

describe("collapseContext", () => {
  const ctx = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      kind: "context" as const,
      text: `l${i}`,
    }));

  test("keeps three lines around a change and folds the rest into a gap", () => {
    const lines = [
      ...ctx(10),
      { kind: "added" as const, text: "new" },
      ...ctx(10),
    ];
    const rows = collapseContext(lines);
    expect(rows[0]).toEqual({ kind: "gap", count: 7 });
    expect(rows.slice(1, 4).map((r) => r.kind)).toEqual([
      "context",
      "context",
      "context",
    ]);
    expect(rows[4]).toEqual({ kind: "added", text: "new" });
    expect(rows[rows.length - 1]).toEqual({ kind: "gap", count: 7 });
    expect(rows).toHaveLength(9);
  });

  test("leaves a short unchanged run between two changes whole", () => {
    const lines = [
      { kind: "removed" as const, text: "x" },
      ...ctx(7),
      { kind: "added" as const, text: "y" },
    ];
    expect(collapseContext(lines)).toEqual(lines);
  });
});
