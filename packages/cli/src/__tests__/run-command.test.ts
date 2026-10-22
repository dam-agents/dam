import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildRunCommand } from "../modules/chat/commands/run.js";
import type {
  RunOutcome,
  RunService,
} from "../modules/chat/services/run-service.js";
import { ok } from "../result.js";

/**
 * TEST_OVERVIEW: What `dam run` prints (#5716). Every run names its session
 * on stderr, so the caller continues the conversation with `--session`
 * without searching `dam session list`; stdout stays the answer. `--json`
 * prints one object on stdout instead, carrying the session id, the stop
 * reason and the answer of a finished run, or `pending` for one that goes on
 * on the agent.
 */

async function dam(
  outcome: RunOutcome,
  args: string[],
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  run: RunService["run"];
}> {
  const run = vi.fn<RunService["run"]>(() => Promise.resolve(ok(outcome)));
  const out = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    out.stderr += String(chunk);
    return true;
  });
  const runService: RunService = { run, get: vi.fn(), cancel: vi.fn() };
  await buildRunCommand({ runService }).parseAsync(
    ["my-agent", "-p", "Howdy!", ...args],
    { from: "user" },
  );
  const exitCode = Number(process.exitCode ?? 0);
  return { ...out, exitCode, run };
}

const completed: RunOutcome = {
  kind: "completed",
  sessionId: "sess-1",
  stopReason: "end_turn",
  text: "Hi there!",
};

describe("dam run output", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  /**
   * TEST_SCENARIO: an ordinary run ends with the stop reason and the
   * session id on stderr, and writes nothing of its own to stdout.
   */
  it("names the session on stderr after a finished run", async () => {
    const { stdout, stderr, exitCode } = await dam(completed, []);

    expect(stderr).toBe("stopReason: end_turn\nsession: sess-1\n");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  /**
   * TEST_SCENARIO: a run past `--timeout` names its session the same way,
   * beside the command that checks it.
   */
  it("names the session on stderr after a timeout", async () => {
    const { stderr } = await dam({ kind: "timed-out", sessionId: "sess-1" }, [
      "--timeout",
      "1",
    ]);

    expect(stderr).toContain("dam run get my-agent sess-1\n");
    expect(stderr).toMatch(/\nsession: sess-1\n$/);
  });

  /**
   * TEST_SCENARIO: `--json` prints the finished run as one object on
   * stdout, and keeps the exit code of its stop reason.
   */
  it("prints the session id, stop reason and answer under --json", async () => {
    const { stdout, exitCode, run } = await dam(
      { ...completed, stopReason: "max_tokens" },
      ["--json"],
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
    expect(JSON.parse(stdout)).toEqual({
      status: "done",
      sessionId: "sess-1",
      stopReason: "max_tokens",
      text: "Hi there!",
    });
    expect(exitCode).not.toBe(0);
  });

  /**
   * TEST_SCENARIO: under `--json --async` stdout is the one object too,
   * a pending run with the session id to poll, not the bare id.
   */
  it("prints a pending run under --json --async", async () => {
    const { stdout } = await dam(
      { kind: "async-started", sessionId: "sess-1" },
      ["--json", "--async"],
    );

    expect(JSON.parse(stdout)).toEqual({
      status: "pending",
      sessionId: "sess-1",
    });
  });
});
