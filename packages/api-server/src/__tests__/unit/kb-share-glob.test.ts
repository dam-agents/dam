import { describe, expect, it } from "vitest";

import { globToMatcher } from "../../modules/kb-shares/serving/glob-matcher.js";
import { runGlobFilterWorker } from "../../modules/kb-shares/serving/grep-worker.js";

describe("globToMatcher", () => {
  // TEST_SCENARIO: **/ asserts a segment boundary — it spans whole directories only, never part of a name.
  it("treats **/ as whole path segments, not a free character run", () => {
    const readme = globToMatcher("**/README.md");
    expect(readme("README.md")).toBe(true);
    expect(readme("wiki/README.md")).toBe(true);
    expect(readme("wiki/guides/README.md")).toBe(true);
    expect(readme("MY-README.md")).toBe(false);
    expect(readme("wiki/MY-README.md")).toBe(false);

    const notes = globToMatcher("wiki/**/notes.md");
    expect(notes("wiki/notes.md")).toBe(true);
    expect(notes("wiki/a/notes.md")).toBe(true);
    expect(notes("wiki/a/b/notes.md")).toBe(true);
    expect(notes("wiki/mynotes.md")).toBe(false);
  });

  // TEST_SCENARIO: single * stays in one segment; **/*.md still matches a top-level file (zero-segment); ? and literals behave.
  it("matches single-segment, zero-segment, and literal patterns", () => {
    expect(globToMatcher("**/*.md")("README.md")).toBe(true);
    expect(globToMatcher("**/*.md")("wiki/a/b.md")).toBe(true);
    expect(globToMatcher("wiki/*.md")("wiki/a.md")).toBe(true);
    expect(globToMatcher("wiki/*.md")("wiki/a/b.md")).toBe(false);
    expect(globToMatcher("wiki/**")("wiki/a/b.md")).toBe(true);
    expect(globToMatcher("a?c.md")("abc.md")).toBe(true);
    expect(globToMatcher("a?c.md")("a/c.md")).toBe(false);
  });
});

describe("runGlobFilterWorker", () => {
  // TEST_SCENARIO: filtering runs in the killable worker (source-injected matcher) and returns exactly the matched paths.
  it("returns only paths the glob matches", async () => {
    const paths = [
      "wiki/index.md",
      "wiki/guides/setup.md",
      "wiki/MY-README.md",
      "README.md",
      "src/a.ts",
    ];
    const matched = await runGlobFilterWorker({ glob: "wiki/**/*.md", paths });
    expect(new Set(matched)).toEqual(
      new Set(["wiki/index.md", "wiki/guides/setup.md", "wiki/MY-README.md"]),
    );
  });
});
