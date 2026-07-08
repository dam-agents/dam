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

  it("survives EPIPE when the harness closes stdin while alive", async () => {
    // The no-chat-harness stub case: the child's stdin reader is gone but the
    // process hasn't exited, so send()'s writable guard still passes and the
    // dispatched write fails async with EPIPE. Without a stdin error handler
    // that's an unhandled 'error' event — it would crash this test process.
    const proc = createChildAgentProcess({
      command: [
        process.execPath,
        "-e",
        // fs.closeSync, not process.stdin.destroy(): node never really closes
        // stdio fds through the stream API, so only the raw close makes the
        // parent's pipe reader-less.
        `require("fs").closeSync(0); console.log("ready"); setTimeout(() => {}, 2000);`,
      ],
      workingDir: process.cwd(),
    });

    // "ready" on stdout ⇒ the child has already destroyed its stdin.
    await new Promise<void>((resolve) => proc.onLine(() => resolve()));

    proc.send({ jsonrpc: "2.0", method: "ping" });
    // Let the dispatched write's async EPIPE surface before passing.
    await new Promise((r) => setTimeout(r, 200));

    proc.kill();
    await proc.exited;
  });

  it("drops sends after the harness exited", async () => {
    const proc = createChildAgentProcess({
      command: [process.execPath, "-e", "process.exit(0)"],
      workingDir: process.cwd(),
    });
    await proc.exited;
    proc.send({ jsonrpc: "2.0", method: "ping" });
    await new Promise((r) => setTimeout(r, 100));
  });
});
