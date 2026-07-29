import { describe, it, expect } from "vitest";
import type { ProcessEntry } from "../../modules/acp/domain/process-tree.js";
import {
  createBackgroundWorkTracker,
  type BackgroundWorkTrackerDeps,
} from "../../modules/acp/services/background-work-tracker.js";

const HARNESS = 100;

const p = (pid: number, ppid: number, startTicks = pid): ProcessEntry => ({
  pid,
  ppid,
  startTicks,
});

/** Pod at rest: init → runtime → harness. */
const POD = [p(1, 0), p(10, 1), p(HARNESS, 10)];
/** The harness's per-session subprocess, spawned at session/new. */
const CLI = p(200, HARNESS);
/** A stdio MCP server — also spawned at session/new, before any prompt. */
const MCP = p(210, 200);
/** A background job the agent starts mid-turn, and its child. */
const JOB_SHELL = p(300, 200, 300);
const JOB = p(301, 300, 301);

function setup(overrides: Partial<BackgroundWorkTrackerDeps> = {}) {
  let table: ProcessEntry[] = [...POD, CLI, MCP];
  let clock = 1_000;
  const logs: string[] = [];
  const tracker = createBackgroundWorkTracker({
    processTable: { read: () => table },
    harnessPid: () => HARNESS,
    snapshotCacheMs: 0,
    now: () => clock,
    log: (m) => logs.push(m),
    ...overrides,
  });
  return {
    tracker,
    logs,
    running: (...extra: ProcessEntry[]) => {
      table = [...POD, CLI, MCP, ...extra];
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createBackgroundWorkTracker", () => {
  it("holds a session whose turn left a process running", () => {
    const { tracker, running } = setup();

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    expect(tracker.hasLiveWork("s1")).toBe(true);
    expect(tracker.heldSessions()).toEqual(["s1"]);
  });

  it("ignores the harness's own machinery, which predates the turn", () => {
    // The per-session subprocess and its stdio MCP servers are spawned when the
    // session is created. A turn that starts nothing must leave the session
    // reapable — otherwise every session would pin its subprocess forever.
    const { tracker } = setup();

    tracker.turnStarted("s1");
    tracker.turnEnded("s1");

    expect(tracker.hasLiveWork("s1")).toBe(false);
    expect(tracker.heldSessions()).toEqual([]);
  });

  it("releases the hold once the work exits", () => {
    const { tracker, running } = setup();

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");
    expect(tracker.hasLiveWork("s1")).toBe(true);

    running(); // job finished
    expect(tracker.hasLiveWork("s1")).toBe(false);
    expect(tracker.heldSessions()).toEqual([]);
  });

  it("keeps holding while the job outlives the shell that launched it", () => {
    // `cmd &` leaves the job reparented onto pid 1 — outside the harness's
    // subtree, still running.
    const { tracker, running } = setup();

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");
    running(p(JOB.pid, 1, JOB.startTicks));

    expect(tracker.hasLiveWork("s1")).toBe(true);
  });

  it("catches a process spawned in the turn's trailing moments", () => {
    // The reap check runs seconds after the response lands; a trailing hook can
    // still start work in between.
    const { tracker, running, advance } = setup({ lateSpawnWindowMs: 5_000 });

    tracker.turnStarted("s1");
    tracker.turnEnded("s1");
    expect(tracker.hasLiveWork("s1")).toBe(false);

    advance(3_000);
    running(JOB_SHELL, JOB);
    expect(tracker.hasLiveWork("s1")).toBe(true);
  });

  it("does not attribute a session opened moments later to this session's turn", () => {
    // The second session's subprocess and MCP server appear under the harness
    // inside the attribution window, and they never exit — holding the first
    // session open until the ceiling.
    const { tracker, running } = setup({ lateSpawnWindowMs: 5_000 });

    tracker.turnStarted("s1");
    tracker.turnEnded("s1");
    running(p(220, HARNESS, 220), p(221, 220, 221));

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("stops attributing new processes once the window closes", () => {
    // Otherwise a long hold would absorb everything the harness starts later —
    // a second session's subprocess, its MCP servers — and never end.
    const { tracker, running, advance } = setup({ lateSpawnWindowMs: 5_000 });

    tracker.turnStarted("s1");
    tracker.turnEnded("s1");
    advance(5_001);
    running(p(220, HARNESS, 220), p(221, 220, 221)); // another session's subprocess

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("treats a recycled pid as a dead process", () => {
    const { tracker, running, advance } = setup({ lateSpawnWindowMs: 5_000 });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    // The job's pids come back on unrelated processes. Attribution has closed,
    // so they are not new work either — and the later start time is what tells
    // them apart from the pids that were held.
    advance(5_001);
    running(
      p(JOB_SHELL.pid, 200, JOB_SHELL.startTicks + 40),
      p(JOB.pid, JOB_SHELL.pid, JOB.startTicks + 40),
    );

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("does not attribute work to a session that never ran a turn", () => {
    const { tracker, running } = setup();

    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("releases a hold that outlives the ceiling", () => {
    const { tracker, running, advance, logs } = setup({ holdMaxMs: 60_000 });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    advance(59_000);
    expect(tracker.hasLiveWork("s1")).toBe(true);

    advance(2_000);
    expect(tracker.hasLiveWork("s1")).toBe(false);
    expect(logs.join("\n")).toContain("ceiling");
  });

  it("never expires a hold when the ceiling is disabled", () => {
    const { tracker, running, advance } = setup({ holdMaxMs: 0 });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");
    advance(30 * 24 * 60 * 60 * 1000);

    expect(tracker.hasLiveWork("s1")).toBe(true);
  });

  it("caps concurrent holds, releasing the longest-held session first", () => {
    // Each held session pins a harness subprocess; the pod's memory limit is
    // what this protects.
    const { tracker, running, advance, logs } = setup({ maxHeldSessions: 1 });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    advance(1_000);
    const second = p(400, 200, 400);
    tracker.turnStarted("s2");
    running(JOB_SHELL, JOB, second);
    tracker.turnEnded("s2");

    expect(tracker.heldSessions()).toEqual(["s2"]);
    expect(logs.join("\n")).toContain("more than 1 sessions holding");
  });

  it("tracks nothing at all when the cap is zero", () => {
    const { tracker, running } = setup({ maxHeldSessions: 0 });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("tracks nothing when no harness pid is known", () => {
    const { tracker, running } = setup({ harnessPid: () => undefined });

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");

    expect(tracker.hasLiveWork("s1")).toBe(false);
  });

  it("drops a session's hold when the session is torn down", () => {
    const { tracker, running } = setup();

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");
    tracker.forget("s1");

    expect(tracker.hasLiveWork("s1")).toBe(false);
    expect(tracker.heldSessions()).toEqual([]);
  });

  it("drops every hold when the harness is recycled", () => {
    // A recycled harness takes its children with it, so nothing is left to hold.
    const { tracker, running } = setup();

    tracker.turnStarted("s1");
    running(JOB_SHELL, JOB);
    tracker.turnEnded("s1");
    tracker.clear();

    expect(tracker.heldSessions()).toEqual([]);
  });

  it("reuses one snapshot across a burst of callers", () => {
    let reads = 0;
    const { tracker } = setup({
      processTable: {
        read: () => {
          reads += 1;
          return [...POD, CLI, MCP];
        },
      },
      snapshotCacheMs: 1_000,
    });

    tracker.turnStarted("s1");
    tracker.turnEnded("s1");
    tracker.heldSessions();
    tracker.heldSessions();

    expect(reads).toBe(1);
  });
});
