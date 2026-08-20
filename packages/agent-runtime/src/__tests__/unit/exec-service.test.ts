import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecService } from "../../modules/exec.js";

// TEST_OVERVIEW: the exec surface — fresh-shell command runs with cwd reporting,
// timeouts, output capping, and background job start/tail/kill.

const envReader = { current: () => ({}), ready: () => true };

describe("exec service", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "exec-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // TEST_SCENARIO: a plain command returns its output, exit code, and the post-command cwd
  it("runs a command and reports output and cwd", async () => {
    const svc = createExecService(workDir, envReader);
    const result = await svc.run({
      command: "echo hello; mkdir -p sub; cd sub",
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello");
    expect(result.output).not.toContain("platform-exec-cwd");
    expect(result.cwd).toBe(join(workDir, "sub"));
    expect(result.timedOut).toBe(false);
  });

  // TEST_SCENARIO: a failing command surfaces its exit code
  it("reports non-zero exit codes", async () => {
    const svc = createExecService(workDir, envReader);
    const result = await svc.run({ command: "exit 3" });
    expect(result.exitCode).toBe(3);
  });

  // TEST_SCENARIO: a command exceeding its timeout is killed with its process group
  it("kills a command on timeout", async () => {
    const svc = createExecService(workDir, envReader);
    const result = await svc.run({ command: "sleep 30", timeoutMs: 1_000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(10_000);
  });

  // TEST_SCENARIO: oversized output is head/tail truncated with a marker
  it("caps oversized output", async () => {
    const svc = createExecService(workDir, envReader);
    const result = await svc.run({
      command: "yes 0123456789abcdef | head -c 500000",
    });
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("[... output truncated ...]");
    expect(result.output.length).toBeLessThan(300_000);
  });

  // TEST_SCENARIO: background jobs stream output through tail and die on kill
  it("starts, tails, and kills a background job", async () => {
    const svc = createExecService(workDir, envReader);
    const { backgroundId } = await svc.start({
      command: "echo started; sleep 30",
    });
    await new Promise((r) => setTimeout(r, 300));
    const tail = await svc.tail(backgroundId);
    expect(tail).not.toBeNull();
    expect(tail?.output).toContain("started");
    expect(tail?.running).toBe(true);
    expect(await svc.kill(backgroundId)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    const after = await svc.tail(backgroundId, tail?.nextOffset);
    expect(after?.running).toBe(false);
    expect(await svc.tail("unknown-id")).toBeNull();
  });
});
