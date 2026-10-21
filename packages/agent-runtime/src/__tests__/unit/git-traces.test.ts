import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GitCommand } from "../../modules/changes/domain/git-trace.js";
import {
  createGitTraceReader,
  STALE_TRACE_MS,
} from "../../modules/changes/infrastructure/git-traces.js";

/**
 * TEST_OVERVIEW: agent-runtime reads the trace files git writes into its
 * trace directory, one per git process. A finished trace is read once and
 * deleted, so the directory never fills up; a trace still being written is
 * left alone until its process exits, or dropped once it is old enough that
 * its process died.
 */

let dir: string;
let commands: GitCommand[];
let clock: number;

const reader = () =>
  createGitTraceReader({
    dir,
    sessionEnvVars: ["CLAUDE_CODE_SESSION_ID"],
    onCommand: (command) => commands.push(command),
    log: () => undefined,
    now: () => clock,
  });

const line = (fields: Record<string, unknown>) =>
  JSON.stringify({ sid: "P1", ...fields });

const finished = [
  line({ event: "def_repo", worktree: "/w/app" }),
  line({ event: "cmd_name", name: "commit" }),
  line({ event: "def_param", param: "CLAUDE_CODE_SESSION_ID", value: "s1" }),
  line({ event: "exit", code: 0 }),
  line({ event: "atexit", code: 0 }),
].join("\n");

const unfinished = finished.split("\n").slice(0, 3).join("\n");

beforeEach(async () => {
  dir = path.join(
    await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "git-traces-"))),
    "traces",
  );
  commands = [];
  clock = Date.now();
});

afterEach(async () => {
  await fs.rm(path.dirname(dir), { recursive: true, force: true });
});

describe("git trace reader", () => {
  /**
   * TEST_SCENARIO: The reader creates its directory, reads a finished trace
   * once and deletes it, so a second read finds nothing more.
   */
  it("should read a finished trace once and delete it", async () => {
    const traces = reader();
    await traces.start();
    await fs.writeFile(path.join(dir, "a"), finished);

    await traces.drain();
    await traces.drain();
    traces.close();

    expect(commands).toEqual([
      { name: "commit", worktree: "/w/app", sessionId: "s1", push: false },
    ]);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A trace whose process is still running is left in place
   * and read once it finishes.
   */
  it("should wait for a trace still being written", async () => {
    const traces = reader();
    await traces.start();
    await fs.writeFile(path.join(dir, "a"), unfinished);

    await traces.drain();
    expect(commands).toEqual([]);
    expect(await fs.readdir(dir)).toEqual(["a"]);

    await fs.writeFile(path.join(dir, "a"), finished);
    await traces.drain();
    traces.close();

    expect(commands).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A trace that never finished, because its process was
   * killed, is deleted once it is old, without linking anything.
   */
  it("should drop an old trace that never finished", async () => {
    const traces = reader();
    await traces.start();
    await fs.writeFile(path.join(dir, "a"), unfinished);

    clock += STALE_TRACE_MS + 1_000;
    await traces.drain();
    traces.close();

    expect(commands).toEqual([]);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A new trace is picked up without anyone calling drain:
   * the reader watches its directory.
   */
  it("should pick up a trace written while it watches", async () => {
    const traces = reader();
    await traces.start();

    await fs.writeFile(path.join(dir, "b"), finished);

    await expect.poll(() => commands.length, { timeout: 10_000 }).toBe(1);
    traces.close();
  });

  /**
   * TEST_SCENARIO: git marks a full directory with a file that makes every
   * later git process skip its trace. The reader deletes the marker at
   * once, so tracing resumes.
   */
  it("should delete the marker git leaves in a full directory", async () => {
    const traces = reader();
    await traces.start();
    await fs.writeFile(path.join(dir, "git-trace2-discard"), "");

    await traces.drain();
    traces.close();

    expect(await fs.readdir(dir)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A git process runs a while: its trace is created at the
   * start, which the watch sees, and finished later, which it does not. The
   * reader sweeps again while the trace is unfinished, so the command links
   * once its process exits, with no other git process running.
   */
  it("should read a trace that finishes after the watch fired", async () => {
    const traces = createGitTraceReader({
      dir,
      sessionEnvVars: ["CLAUDE_CODE_SESSION_ID"],
      onCommand: (command) => commands.push(command),
      log: () => undefined,
      unfinishedSweepMs: 100,
    });
    await traces.start();
    await fs.writeFile(path.join(dir, "slow"), unfinished);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await traces.drain();
    expect(commands).toEqual([]);

    await fs.appendFile(
      path.join(dir, "slow"),
      "\n" + finished.split("\n").slice(3).join("\n"),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    traces.close();

    expect(commands).toHaveLength(1);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
