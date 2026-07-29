import { describe, it, expect } from "vitest";
import {
  descendantKeys,
  liveKeys,
  newDescendantsBelowBaseline,
  processKey,
  type ProcessEntry,
} from "../../modules/acp/domain/process-tree.js";

const p = (pid: number, ppid: number, startTicks = pid): ProcessEntry => ({
  pid,
  ppid,
  startTicks,
  comm: `proc${pid}`,
});

describe("descendantKeys", () => {
  it("walks the tree transitively and excludes the root itself", () => {
    // runtime(10) → harness(100) → cli(200) → shell(300) → job(301)
    const snapshot = [
      p(1, 0),
      p(10, 1),
      p(100, 10),
      p(200, 100),
      p(300, 200),
      p(301, 300),
    ];

    const keys = descendantKeys(snapshot, 100);

    expect([...keys].sort()).toEqual(
      [p(200, 100), p(300, 200), p(301, 300)].map(processKey).sort(),
    );
    expect(keys.has(processKey(p(100, 10)))).toBe(false);
  });

  it("excludes processes outside the root's subtree", () => {
    // A PTY shell and an sshd hang off the runtime, not the harness — the pod's
    // other tenants must never read as a chat session's background work.
    const snapshot = [p(1, 0), p(10, 1), p(100, 10), p(400, 10), p(401, 400)];

    expect([...descendantKeys(snapshot, 100)]).toEqual([]);
  });

  it("keys a process by pid and start time, so a recycled pid is a new process", () => {
    const before = descendantKeys([p(100, 10), p(300, 100, 50)], 100);
    const after = descendantKeys([p(100, 10), p(300, 100, 90)], 100);

    expect([...before]).not.toEqual([...after]);
  });

  it("terminates on a torn snapshot that implies a cycle", () => {
    // Pids are read one at a time, so a snapshot can be internally
    // inconsistent; the walk must still finish.
    const snapshot = [p(100, 10), p(200, 100), p(100, 200)];

    expect(() => descendantKeys(snapshot, 100)).not.toThrow();
  });

  it("returns nothing for a root that isn't in the snapshot", () => {
    expect([...descendantKeys([p(1, 0), p(10, 1)], 999)]).toEqual([]);
  });
});

describe("newDescendantsBelowBaseline", () => {
  const HARNESS = 100;
  const CLI_A = p(200, HARNESS);
  const baseline = () =>
    descendantKeys([p(HARNESS, 10), CLI_A, p(210, 200)], HARNESS);

  it("finds work started under a session's existing subprocess, transitively", () => {
    const snapshot = [
      p(HARNESS, 10),
      CLI_A,
      p(210, 200), // MCP server, already running
      p(300, 200, 300), // shell the turn started
      p(301, 300, 301), // the job itself
    ];

    const work = newDescendantsBelowBaseline(snapshot, HARNESS, baseline());

    expect([...work].sort()).toEqual(
      [p(300, 200, 300), p(301, 300, 301)].map(processKey).sort(),
    );
  });

  it("does not claim another session's subprocess or its MCP servers", () => {
    // Regression: opening a second session moments after the first session's
    // turn made the first session look like it had spawned work that never
    // ends, holding it open until the ceiling.
    const snapshot = [
      p(HARNESS, 10),
      CLI_A,
      p(210, 200),
      p(220, HARNESS, 220), // second session's subprocess
      p(221, 220, 221), // its MCP server
    ];

    expect([
      ...newDescendantsBelowBaseline(snapshot, HARNESS, baseline()),
    ]).toEqual([]);
  });

  it("finds nothing when the turn started nothing", () => {
    const snapshot = [p(HARNESS, 10), CLI_A, p(210, 200)];

    expect([
      ...newDescendantsBelowBaseline(snapshot, HARNESS, baseline()),
    ]).toEqual([]);
  });

  it("ignores processes outside the harness's subtree", () => {
    const snapshot = [p(HARNESS, 10), CLI_A, p(210, 200), p(400, 10, 400)];

    expect([
      ...newDescendantsBelowBaseline(snapshot, HARNESS, baseline()),
    ]).toEqual([]);
  });

  it("terminates on a torn snapshot that implies a cycle", () => {
    const snapshot = [
      p(HARNESS, 10),
      CLI_A,
      p(300, 301, 300),
      p(301, 300, 301),
    ];

    expect(() =>
      newDescendantsBelowBaseline(snapshot, HARNESS, baseline()),
    ).not.toThrow();
  });
});

describe("liveKeys", () => {
  it("is ancestry-blind, so work reparented onto pid 1 still counts as alive", () => {
    // The shell that launched a background job exits; the job is reparented
    // onto pid 1 and keeps running. It has left the harness's subtree, but it
    // is very much alive.
    const job = p(301, 1, 51);

    expect(liveKeys([p(1, 0), p(100, 10), job]).has(processKey(job))).toBe(
      true,
    );
  });
});
