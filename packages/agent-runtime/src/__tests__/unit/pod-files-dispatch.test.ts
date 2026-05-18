import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../../modules/pod-files/index.js";

/**
 * End-to-end glue between an SSE event payload and a file on disk:
 * data → JSON parse → applyFile per entry. The per-file try/catch is
 * what lets one entry that throws inside applyFile coexist with
 * well-formed siblings — a single bad entry must not poison the rest
 * of the batch.
 */
describe("dispatch", () => {
  it("writes the well-formed entry and tolerates a sibling that throws in applyFile", () => {
    const home = mkdtempSync(join(tmpdir(), "pod-files-dispatch-"));
    const goodPath = join(home, "good.yml");
    const evilPath = join(
      mkdtempSync(join(tmpdir(), "elsewhere-")),
      "evil.yml",
    );
    const payload = JSON.stringify({
      files: [
        // Well-formed shape, but applyFile rejects this: path resolves
        // outside agentHome, so the path-access guard throws.
        {
          path: evilPath,
          mode: "yaml-fill-if-missing",
          fragments: [{ x: "y" }],
        },
        // Well-formed all the way through.
        {
          path: goodPath,
          mode: "yaml-fill-if-missing",
          fragments: [{ a: { b: "c" } }],
        },
      ],
    });

    expect(() => dispatch("upsert", payload, home)).not.toThrow();
    expect(existsSync(goodPath)).toBe(true);
    expect(readFileSync(goodPath, "utf8")).toContain("a:");
    // The throwing sibling left no trace.
    expect(existsSync(evilPath)).toBe(false);
  });
});
