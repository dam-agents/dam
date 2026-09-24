import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EventContext } from "agent-runtime-api";
import {
  createWorkspaceCommandPlugin,
  runCommand,
  type RunCommandFn,
} from "../../modules/runtime-channel/drivers/workspace-command-plugin.js";

function setup(run: RunCommandFn) {
  const root = mkdtempSync(join(tmpdir(), "ws-cmd-"));
  const workDir = join(root, "work");
  const pluginStateDir = join(root, "state");
  mkdirSync(pluginStateDir, { recursive: true });
  const handler = createWorkspaceCommandPlugin({
    workDir,
    log: () => {},
    run,
  }).bindEvent!("workspace-command", { impl: "workspace-command" });
  const ctx: EventContext = {
    eventId: "evt-1:1",
    agentHome: root,
    pluginStateDir,
    log: () => {},
  };
  return {
    run: (command: string) => handler({ command }, ctx),
    workDir,
    sentinel: join(pluginStateDir, "command.done"),
  };
}

describe("workspace-command plugin", () => {
  it("runs the command in the work dir and writes a done sentinel", async () => {
    const runner = vi.fn<RunCommandFn>(async () => {});
    const { run, workDir, sentinel } = setup(runner);
    await run("bootstrap");
    expect(runner).toHaveBeenCalledWith(
      "bootstrap",
      workDir,
      expect.any(Function),
    );
    expect(existsSync(sentinel)).toBe(true);
  });

  it("skips a second run once the sentinel exists", async () => {
    const runner = vi.fn<RunCommandFn>(async () => {});
    const { run } = setup(runner);
    await run("bootstrap");
    await run("bootstrap");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("throws and writes no sentinel when the command fails", async () => {
    const runner = vi.fn<RunCommandFn>(async () => {
      throw new Error("workspace command exited with code 3");
    });
    const { run, sentinel } = setup(runner);
    await expect(run("bootstrap")).rejects.toThrow(/code 3/);
    expect(existsSync(sentinel)).toBe(false);
  });

  // TEST_SCENARIO: a failed install becomes the reason a spawned sub-agent's Invocation fails, and the sub-agent is deleted right after, so the last lines the command printed must travel in the error rather than only in the pod log.
  it("reports the tail of what a failed command printed", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "ws-cmd-run-"));
    await expect(
      runCommand(
        "echo step-one; echo no matching distribution >&2; exit 3",
        workDir,
        () => {},
      ),
    ).rejects.toThrow(/exited 3: step-one\nno matching distribution$/);
  });

  it("keeps only the last lines of a long failure", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "ws-cmd-run-"));
    const failure = await runCommand(
      "for i in $(seq 1 50); do echo line-$i; done; exit 1",
      workDir,
      () => {},
    ).catch((err: unknown) => String(err));
    expect(failure).toContain("line-50");
    expect(failure).not.toContain("line-40\n");
  });
});
