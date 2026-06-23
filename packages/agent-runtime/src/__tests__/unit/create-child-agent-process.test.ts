import { describe, it, expect } from "vitest";
import { createChildAgentProcess } from "../../modules/acp/infrastructure/create-child-agent-process.js";

describe("createChildAgentProcess", () => {
  it("reassembles a frame split across stdout chunks and skips blank lines", async () => {
    // First write has no trailing newline, so the frame is only complete
    // after the second write — the incremental-buffering case the readline
    // swap must handle (and the old per-chunk re-split did, O(n²)).
    const script = [
      `process.stdout.write('{"id":1,"a":');`,
      `setTimeout(() => {`,
      `  process.stdout.write('"hello"}\\n   \\n{"id":2}\\n');`,
      `  process.exit(0);`,
      `}, 20);`,
    ].join("\n");

    const proc = createChildAgentProcess({
      command: [process.execPath, "-e", script],
      workingDir: process.cwd(),
    });

    const lines: string[] = [];
    const got = new Promise<void>((resolve) => {
      proc.onLine((l) => {
        lines.push(l);
        if (lines.length === 2) resolve();
      });
    });
    await got;

    expect(lines).toEqual(['{"id":1,"a":"hello"}', '{"id":2}']);
  });
});
