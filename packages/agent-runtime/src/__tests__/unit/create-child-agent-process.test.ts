import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { describe, it, expect } from "vitest";
import { createChildAgentProcess } from "../../modules/acp/infrastructure/create-child-agent-process.js";

describe("createChildAgentProcess", () => {
  it("reassembles a frame split across stdout chunks and skips blank lines", async () => {
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
    const proc = createChildAgentProcess({
      command: [
        process.execPath,
        "-e",
        `require("fs").closeSync(0); console.log("ready"); setTimeout(() => {}, 2000);`,
      ],
      workingDir: process.cwd(),
    });

    await new Promise<void>((resolve) => proc.onLine(() => resolve()));

    proc.send({ jsonrpc: "2.0", method: "ping" });
    await new Promise((r) => setTimeout(r, 200));

    proc.kill();
    await proc.exited;
  });

  it("creates a missing workingDir instead of failing the spawn", async () => {
    const dir = `${tmpdir()}/capd-${process.pid}-${Date.now()}/nested`;
    const proc = createChildAgentProcess({
      command: [process.execPath, "-e", `console.log("ok")`],
      workingDir: dir,
    });
    const line = await new Promise<string>((resolve) => proc.onLine(resolve));
    expect(line).toBe("ok");
    await proc.exited;
    rmSync(dirname(dir), { recursive: true, force: true });
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

// TEST_SCENARIO: A missing native login must survive the subprocess boundary as actionable feedback, while unrelated exits and stderr keep their generic cause.
describe("native ChatGPT startup failures", () => {
  it.each([
    ["chatgpt", 77, "ChatGPT sign-in is required on this agent."],
    ["chatgpt", 1, "exit code 1"],
    [undefined, 77, "exit code 77"],
  ])("reports mode %s and exit %s safely", async (mode, code, expected) => {
    const proc = createChildAgentProcess({
      command: [
        process.execPath,
        "-e",
        `console.error("unrelated harness output"); process.exit(${code});`,
      ],
      workingDir: process.cwd(),
      env: { ...process.env, PLATFORM_CODEX_AUTH_MODE: mode },
    });
    await proc.exited;
    expect(proc.exitCause()).toBe(expected);
    expect(proc.exitCause()).not.toContain("unrelated harness output");
  });
});
