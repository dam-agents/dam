import { describe, expect, it } from "vitest";
import type { WorkItem } from "api-server-api";
import { parseCommandSurface } from "../modules/satellite/domain/command-surface.js";
import {
  createCommandBackend,
  runTool,
} from "../modules/satellite/services/command-backend.js";
import {
  createWorker,
  SatelliteRemovedError,
  type WorkerTransport,
} from "../modules/satellite/services/worker.js";

/**
 * TEST_OVERVIEW: The satellite worker and the command-surface backend, which is
 * where the allowlist is now enforced in full: the platform forwards a tool call
 * without reading its arguments, so the machine alone decides what may run on
 * it. These specs run real processes through that path — a permitted command
 * reports its exit code and output, a command the surface does not permit is
 * refused without running — a finished call whose result is an error, since
 * the outcome is certain — one that needs a human is held rather than run, and
 * several Jobs run at once. They also pin what the surface sends: cwd, timeouts
 * and the patterns themselves stay local, so the platform never learns the
 * machine's filesystem layout, and a malformed duration or a pattern that would
 * let the caller choose the program is rejected at startup rather than at run
 * time.
 */

const PATTERNS = `
/bin/echo (hello|goodbye)  # Say something
/bin/tail -f /etc/hosts
/bin/sleep ^[1-9]$
`;

const IDENTITY = { name: "test-box", maxConcurrent: 4 };

function surface(timeout?: string) {
  const parsed = parseCommandSurface(PATTERNS, {
    ...IDENTITY,
    ...(timeout === undefined ? {} : { timeout }),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

interface Reported {
  sequence: number;
  outcome: Parameters<WorkerTransport["report"]>[0]["outcome"];
}

function harness(items: WorkItem[], timeout?: string) {
  const reports: Reported[] = [];
  let handedOut = false;
  let resolveAll: () => void = () => {};
  const allReported = new Promise<void>((r) => {
    resolveAll = r;
  });

  const transport: WorkerTransport = {
    connect: async () => {},
    claim: async () => {
      if (handedOut) return [];
      handedOut = true;
      return items;
    },
    heartbeat: async () => {},
    drain: async () => {},
    report: async (input) => {
      reports.push({ sequence: input.sequence, outcome: input.outcome });
      if (reports.length === items.length) resolveAll();
    },
  };

  const parsed = surface(timeout);
  const backend = createCommandBackend(parsed, { line: () => {} });
  const worker = createWorker({
    name: parsed.pushed.name,
    maxConcurrent: parsed.pushed.maxConcurrent,
    backend,
    transport,
    log: { line: () => {} },
    host: "test-host",
  });
  return { worker, backend, reports, allReported };
}

function runItem(sequence: number, cmd: string[]): WorkItem {
  return { kind: "call", sequence, tool: "run", args: { cmd } };
}

async function drive(items: WorkItem[]): Promise<Reported[]> {
  const { worker, reports, allReported } = harness(items);
  const running = worker.start();
  await allReported;
  await worker.drain();
  await running;
  return reports;
}

describe("the satellite worker", () => {
  it("runs a permitted command and reports its exit code and output", async () => {
    const [report] = await drive([runItem(1, ["/bin/echo", "hello"])]);
    expect(report?.outcome.status).toBe("done");
    if (report?.outcome.status !== "done") return;
    expect(report.outcome.exitCode).toBe(0);
    expect(report.outcome.output).toContain("hello");
  });

  it("refuses a command the local manifest does not permit, without running it", async () => {
    const [report] = await drive([runItem(2, ["/bin/echo", "$(whoami)"])]);
    expect(report?.outcome.status).toBe("done");
    if (report?.outcome.status !== "done") return;
    expect(report.outcome.isError).toBe(true);
    expect(report.outcome.exitCode).toBeNull();
    expect(report.outcome.output).toContain("refused locally");
  });

  it("refuses a program that appears in no pattern", async () => {
    const [report] = await drive([runItem(3, ["/bin/cat", "/etc/passwd"])]);
    expect(report?.outcome.status).toBe("done");
    if (report?.outcome.status !== "done") return;
    expect(report.outcome.isError).toBe(true);
  });

  it("runs several jobs at once", async () => {
    const reports = await drive([
      runItem(1, ["/bin/echo", "hello"]),
      runItem(2, ["/bin/echo", "goodbye"]),
      runItem(3, ["/bin/sleep", "1"]),
    ]);
    expect(reports).toHaveLength(3);
    expect(reports.every((r) => r.outcome.status === "done")).toBe(true);
  });
});

describe("claiming work", () => {
  function worker(transport: WorkerTransport, maxConcurrent: number) {
    const parsed = parseCommandSurface(PATTERNS, {
      name: "test-box",
      maxConcurrent,
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const lines: string[] = [];
    return {
      lines,
      worker: createWorker({
        name: parsed.value.pushed.name,
        maxConcurrent,
        backend: createCommandBackend(parsed.value, { line: () => {} }),
        transport,
        log: { line: (text) => lines.push(text) },
        host: "test-host",
      }),
    };
  }

  /**
   * TEST_SCENARIO: With every slot taken, the worker still polls, but only for
   * cancellations, and that poll can wait out the whole long-poll window. A Job
   * admitted when a slot frees must not sit queued behind it: the platform told
   * the Agent the call would start, and a short call that should have returned
   * inline would come back as a job reference instead.
   */
  it("takes new work as soon as a slot frees, without waiting out the poll", async () => {
    const reports: number[] = [];
    let calls = 0;
    let finished: () => void = () => {};
    const bothDone = new Promise<void>((r) => {
      finished = r;
    });
    const transport: WorkerTransport = {
      connect: async () => {},
      claim: async ({ capacity }) => {
        if (capacity === 0) return new Promise<never>(() => {});
        calls++;
        if (calls === 1) return [runItem(1, ["/bin/sleep", "1"])];
        if (calls === 2) return [runItem(2, ["/bin/echo", "hello"])];
        return [];
      },
      heartbeat: async () => {},
      drain: async () => {},
      report: async (input) => {
        reports.push(input.sequence);
        if (reports.length === 2) finished();
      },
    };
    const { worker: w } = worker(transport, 1);
    const running = w.start();
    const startedAt = Date.now();
    await bothDone;
    expect(reports).toEqual([1, 2]);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    await w.drain();
    await running;
  });

  /**
   * TEST_SCENARIO: A Satellite removed on the platform no longer exists to
   * claim for. Retrying forever keeps the machine calling in and fills its log
   * with an error that never resolves; re-registering would undo the removal.
   * The worker says it was removed, lets what is running finish, and stops.
   */
  it("stops claiming once the satellite is removed, after its running job ends", async () => {
    const reports: number[] = [];
    let calls = 0;
    const transport: WorkerTransport = {
      connect: async () => {},
      claim: async ({ satellite }) => {
        calls++;
        if (calls === 1) return [runItem(1, ["/bin/sleep", "1"])];
        throw new SatelliteRemovedError(satellite);
      },
      heartbeat: async () => {},
      drain: async () => {},
      report: async (input) => {
        reports.push(input.sequence);
      },
    };
    const { worker: w, lines } = worker(transport, 4);
    await w.start();
    expect(reports).toEqual([1]);
    expect(calls).toBe(2);
    expect(lines.some((line) => line.includes("was removed"))).toBe(true);
  });
});

describe("a job that does not run to completion", () => {
  it("reports a cancelled job as cancelled, not as a finished one that failed", async () => {
    const { worker, backend, reports, allReported } = harness([
      runItem(1, ["/bin/sleep", "9"]),
    ]);
    const running = worker.start();
    await new Promise((r) => setTimeout(r, 300));
    backend.cancel(1);
    await allReported;
    await worker.drain();
    await running;
    expect(reports[0]?.outcome.status).toBe("cancelled");
  });

  it("still reports what the job printed before it was killed", async () => {
    const { worker, backend, reports, allReported } = harness([
      runItem(1, ["/bin/tail", "-f", "/etc/hosts"]),
    ]);
    const running = worker.start();
    await new Promise((r) => setTimeout(r, 400));
    backend.cancel(1);
    await allReported;
    await worker.drain();
    await running;
    const outcome = reports[0]?.outcome;
    expect(outcome?.status).toBe("cancelled");
    if (outcome?.status !== "cancelled") return;
    expect(
      outcome.output,
      "a cancelled job's output is the only record of what it did",
    ).toContain("localhost");
  });

  it("reports a job killed at its timeout as interrupted, naming the timeout", async () => {
    const { worker, reports, allReported } = harness(
      [runItem(1, ["/bin/sleep", "9"])],
      "1s",
    );
    const running = worker.start();
    await allReported;
    await worker.drain();
    await running;
    expect(reports[0]?.outcome.status).toBe("interrupted");
    if (reports[0]?.outcome.status !== "interrupted") return;
    expect(reports[0].outcome.reason).toContain("timeout");
  });
});

describe("parsing the command surface", () => {
  it("keeps cwd and timeouts local, and never puts them where the platform can see", () => {
    const parsed = parseCommandSurface(
      "./x ^[1-5]$   # Do x  [timeout=30m cwd=/tmp]",
      { name: "box", maxConcurrent: 16, cwd: "/srv", timeout: "6h" },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.cwd).toBe("/srv");
    expect(parsed.value.timeoutMs).toBe(6 * 3_600_000);
    expect(parsed.value.commands[0]?.timeoutMs).toBe(30 * 60_000);
    expect(parsed.value.commands[0]?.cwd).toBe("/tmp");
    expect(parsed.value.commands[0]?.about).toBe("Do x");
    expect(JSON.stringify(parsed.value.pushed)).not.toContain("/srv");
    expect(
      JSON.stringify(runTool(parsed.value)),
      "the tool describes the shapes but never the machine's layout",
    ).not.toContain("/srv");
  });

  /**
   * TEST_SCENARIO: A pattern may hold a # inside a token — an anchored regex is
   * the common case. Only a # that opens a word starts the description, so such
   * a pattern needs no escaping and cannot be silently truncated.
   */
  it("treats a # inside a token as part of the pattern, not a comment", () => {
    const parsed = parseCommandSurface("./x ^build#[0-9]+$  # About it", {
      name: "box",
      maxConcurrent: 16,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.commands[0]?.run).toBe("./x ^build#[0-9]+$");
    expect(parsed.value.commands[0]?.about).toBe("About it");
  });

  it("skips blank lines and whole-line comments", () => {
    const parsed = parseCommandSurface(
      "\n# just a note\n./x\n\n  # another\n./y\n",
      { name: "box", maxConcurrent: 16 },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.commands.map((c) => c.run)).toEqual(["./x", "./y"]);
  });

  it("names the line a bad pattern is on, since the text is the whole manifest", () => {
    const parsed = parseCommandSurface("./ok\n*\n", {
      name: "box",
      maxConcurrent: 16,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("line 2");
  });

  it("refuses an option it does not know rather than ignoring it", () => {
    const parsed = parseCommandSurface("./x  # About  [maxx=2]", {
      name: "box",
      maxConcurrent: 16,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("unknown option");
  });

  it("rejects a timeout the timer cannot hold, rather than killing the job at once", () => {
    const parsed = parseCommandSurface("./x", {
      name: "box",
      maxConcurrent: 16,
      timeout: "999999h",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("timeout");
  });

  it("rejects a malformed duration rather than guessing", () => {
    expect(
      parseCommandSurface("./x", {
        name: "box",
        maxConcurrent: 16,
        timeout: "soon",
      }).ok,
    ).toBe(false);
  });

  it("rejects a pattern that lets the caller choose the program", () => {
    expect(
      parseCommandSurface("*", { name: "box", maxConcurrent: 16 }).ok,
    ).toBe(false);
  });

  it("refuses an empty surface — there would be nothing to expose", () => {
    expect(
      parseCommandSurface("\n# nothing here\n", {
        name: "box",
        maxConcurrent: 16,
      }).ok,
    ).toBe(false);
  });

  it("refuses a name or concurrency the server would refuse, on the machine", () => {
    expect(
      parseCommandSurface("./x", { name: "Not A Name", maxConcurrent: 16 }).ok,
    ).toBe(false);
    expect(
      parseCommandSurface("./x", { name: "box", maxConcurrent: 0 }).ok,
    ).toBe(false);
  });
});

describe("the tool a command surface advertises", () => {
  it("offers exactly one tool, taking the command to run", () => {
    const tool = runTool(surface());
    expect(tool.name).toBe("run");
    expect((tool.inputSchema as { required?: string[] }).required).toEqual([
      "cmd",
    ]);
  });

  it("carries the permitted shapes in the description, where a model reads them", () => {
    expect(runTool(surface()).description).toContain(
      "/bin/echo (hello|goodbye)",
    );
  });
});
