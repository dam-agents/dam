import { describe, expect, it, vi } from "vitest";
import type { SatelliteManifest, WorkItem } from "api-server-api";
import { createBackoff } from "../modules/shared/backoff.js";
import { parseCommandSurface } from "../modules/satellite/domain/command-surface.js";
import {
  createCommandBackend,
  runTool,
} from "../modules/satellite/services/command-backend.js";
import {
  createWorker,
  describeOffline,
  SatelliteRemovedError,
  type WorkerTransport,
} from "../modules/satellite/services/worker.js";
import { AuthRequiredAtTransportError } from "../modules/shared/trpc/trpc-client.js";

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
 *
 * The worker's log is the interface for whoever is at the machine, so the specs
 * also pin what it says: each request names the Agent that sent it and what it
 * asked for, and each outcome reads differently for a command that ran, one
 * that failed, and one the machine refused.
 */

const PATTERNS = `
/bin/echo (hello|goodbye)  # Say something
/usr/bin/tail -f /etc/hosts
/bin/sleep ^[1-9]$
/usr/bin/false  # Fail
`;

const IDENTITY = { name: "test-box", maxConcurrent: 4 };

function surface() {
  const parsed = parseCommandSurface(PATTERNS, IDENTITY);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

interface Reported {
  sequence: number;
  outcome: Parameters<WorkerTransport["report"]>[0]["outcome"];
}

function harness(items: WorkItem[], timeoutMs?: number) {
  const reports: Reported[] = [];
  const lines: string[] = [];
  let handedOut = false;
  let drained: () => void = () => {};
  const untilDrained = new Promise<WorkItem[]>((r) => {
    drained = () => r([]);
  });
  let resolveAll: () => void = () => {};
  const allReported = new Promise<void>((r) => {
    resolveAll = r;
  });

  const transport: WorkerTransport = {
    connect: async () => {},
    claim: async () => {
      if (handedOut) return untilDrained;
      handedOut = true;
      return items;
    },
    heartbeat: async () => {},
    drain: async () => drained(),
    report: async (input) => {
      reports.push({ sequence: input.sequence, outcome: input.outcome });
      if (reports.length === items.length) resolveAll();
    },
  };

  const parsed = {
    ...surface(),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const backend = createCommandBackend(parsed);
  const worker = createWorker({
    name: parsed.pushed.name,
    maxConcurrent: parsed.pushed.maxConcurrent,
    backend,
    transport,
    log: { line: (text) => lines.push(text) },
    host: "test-host",
    guide: ["open the UI"],
  });
  return { worker, backend, reports, lines, allReported };
}

function runItem(
  sequence: number,
  cmd: string[],
  agent?: WorkItem["agent"],
): WorkItem {
  return {
    kind: "call",
    sequence,
    tool: "run",
    args: { cmd },
    ...(agent === undefined ? {} : { agent }),
  };
}

async function driveLogged(
  items: WorkItem[],
): Promise<{ reports: Reported[]; lines: string[] }> {
  const { worker, reports, lines, allReported } = harness(items);
  const running = worker.start();
  await allReported;
  await worker.drain();
  await running;
  return { reports, lines };
}

async function drive(items: WorkItem[]): Promise<Reported[]> {
  return (await driveLogged(items)).reports;
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
    const reports = await drive([
      runItem(2, ["/bin/echo", "$(whoami)"]),
      runItem(3, ["/bin/cat", "/etc/passwd"]),
    ]);
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.outcome.status).toBe("done");
      if (report.outcome.status !== "done") return;
      expect(report.outcome.isError).toBe(true);
      expect(report.outcome.exitCode).toBeNull();
      expect(report.outcome.output).toContain("refused locally");
    }
  });

  it("runs several jobs at once", async () => {
    const { worker, backend, reports, allReported } = harness([
      runItem(1, ["/usr/bin/tail", "-f", "/etc/hosts"]),
      runItem(2, ["/usr/bin/tail", "-f", "/etc/hosts"]),
    ]);
    const running = worker.start();
    await vi.waitFor(() => expect(worker.runningCount).toBe(2));
    backend.cancel(1);
    backend.cancel(2);
    await allReported;
    await worker.drain();
    await running;
    expect(reports.map((r) => r.outcome.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });
});

describe("the worker's log", () => {
  const AGENT = { id: "agent-1a2b", name: "Builder" };

  it("names the agent behind each request and reads each outcome differently", async () => {
    const { reports, lines } = await driveLogged([
      runItem(1, ["/bin/echo", "hello"], AGENT),
      runItem(2, ["/bin/cat", "/etc/passwd"], AGENT),
      runItem(3, ["/usr/bin/false"], AGENT),
      runItem(4, ["/bin/echo", "hello"], { id: "agent-9z", name: null }),
    ]);
    expect(lines).toContain(
      "REQUEST #1 from Builder (agent-1a2b): /bin/echo hello",
    );
    expect(
      lines.some((line) => /^DONE #1 in \d+\.\ds: exit 0$/.test(line)),
    ).toBe(true);
    expect(lines.find((line) => line.startsWith("BLOCKED #2: "))).toContain(
      "refused locally",
    );
    expect(
      Object.keys(reports.find((r) => r.sequence === 2)?.outcome ?? {}),
    ).not.toContain("blocked");
    expect(lines.some((line) => /^FAILED #3 in .*: exit 1$/.test(line))).toBe(
      true,
    );
    expect(lines.some((line) => line.startsWith("BLOCKED #3"))).toBe(false);
    expect(lines).toContain("REQUEST #4 from agent-9z: /bin/echo hello");
    const connected = lines.findIndex((line) =>
      line.startsWith("connected as"),
    );
    expect(connected).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf("open the UI")).toBeGreaterThan(connected);
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
        backend: createCommandBackend(parsed.value),
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
    let drained: () => void = () => {};
    let finished: () => void = () => {};
    const bothDone = new Promise<void>((r) => {
      finished = r;
    });
    const transport: WorkerTransport = {
      connect: async () => {},
      claim: async ({ capacity }) => {
        if (capacity === 0) return new Promise<never>(() => {});
        calls++;
        if (calls === 1) return [runItem(1, ["/bin/echo", "goodbye"])];
        if (calls === 2) return [runItem(2, ["/bin/echo", "hello"])];
        return new Promise((r) => {
          drained = () => r([]);
        });
      },
      heartbeat: async () => {},
      drain: async () => drained(),
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
        if (calls === 1) return [runItem(1, ["/bin/echo", "hello"])];
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
  it("reports a cancelled job as cancelled, with what it printed before it was killed", async () => {
    const { worker, backend, reports, allReported } = harness([
      runItem(1, ["/usr/bin/tail", "-f", "/etc/hosts"]),
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
      50,
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
describe("surviving a drop", () => {
  const FAST = { baseMs: 2, capMs: 4 };

  type Poll = {
    resolve: (items: WorkItem[]) => void;
    reject: (err: Error) => void;
  };

  function pollQueue() {
    const polls: Poll[] = [];
    return {
      polls,
      binding: () =>
        new Promise<WorkItem[]>((resolve, reject) => {
          polls.push({ resolve, reject });
        }),
      release: () => {
        for (const poll of polls.splice(0)) poll.resolve([]);
      },
    };
  }

  function workerWith(
    transport: WorkerTransport,
    backend?: Parameters<typeof createWorker>[0]["backend"],
  ) {
    const parsed = parseCommandSurface(PATTERNS, IDENTITY);
    if (!parsed.ok) throw new Error(parsed.error);
    const lines: string[] = [];
    return {
      lines,
      worker: createWorker({
        name: parsed.value.pushed.name,
        maxConcurrent: IDENTITY.maxConcurrent,
        backend: backend ?? createCommandBackend(parsed.value),
        transport,
        log: { line: (text) => lines.push(text) },
        host: "test-host",
        retry: FAST,
        drainGraceMs: 50,
      }),
    };
  }

  /**
   * TEST_SCENARIO: The platform stops answering, and answers again later.
   * Neither ends the process: it waits, says so on each attempt, registers the
   * same Satellite again under the same name with the same tools, and names the
   * registration it was already serving so a different one is never taken over.
   */
  it("keeps trying, registers the same satellite again, and resumes claiming", async () => {
    const connects: { manifest: SatelliteManifest; resume?: string }[] = [];
    const reports: { sequence: number; incarnation?: string }[] = [];
    const queue = pollQueue();
    let down = false;
    const transport: WorkerTransport = {
      connect: async (input) => {
        connects.push({
          manifest: input.manifest,
          ...(input.resume === undefined ? {} : { resume: input.resume }),
        });
        if (down) throw new Error("fetch failed");
        return { incarnation: "reg-1" };
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reports.push({
          sequence: input.sequence,
          ...(input.incarnation === undefined
            ? {}
            : { incarnation: input.incarnation }),
        });
      },
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    down = true;
    queue.polls[0]?.reject(new Error("fetch failed"));
    await vi.waitFor(() => expect(connects.length).toBeGreaterThanOrEqual(3));
    down = false;
    await vi.waitFor(() => expect(queue.polls).toHaveLength(2));

    queue.polls[1]?.resolve([runItem(1, ["/bin/echo", "hello"])]);
    await vi.waitFor(() =>
      expect(reports).toEqual([{ sequence: 1, incarnation: "reg-1" }]),
    );
    await worker.drain();
    await running;

    expect(
      connects.map((entry) => entry.manifest.name),
      "a reconnect registers the same Satellite, never a second one",
    ).toEqual(connects.map(() => "test-box"));
    expect(connects.at(-1)?.manifest.tools).toEqual(
      connects[0]?.manifest.tools,
    );
    expect(connects[0]?.resume, "the first registration resumes nothing").toBe(
      undefined,
    );
    expect(
      connects.slice(1).map((entry) => entry.resume),
      "a reconnect names the registration it already served",
    ).toEqual(connects.slice(1).map(() => "reg-1"));
    expect(
      lines.filter((line) => line.startsWith("connected as ")),
      "the tools are announced once, not on every reconnect",
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line === 'reconnected as "test-box"'),
      "saying so is what makes a service log readable",
    ).toHaveLength(1);
    expect(
      lines.some((line) =>
        line.startsWith("offline: Error: fetch failed — retrying in"),
      ),
    ).toBe(true);
  });

  /**
   * TEST_SCENARIO: A call that finished just as the connection went away has an
   * outcome nobody else can supply: the lease sweep reports the Job as unknown
   * a minute later. The worker holds it and sends it once the platform is back,
   * so a short drop costs no result.
   */
  it("sends an outcome that could not be reported once the platform is back", async () => {
    const reports: number[] = [];
    let reportCalls = 0;
    let claimCalls = 0;
    let drained: () => void = () => {};
    let failedOnce: () => void = () => {};
    const reportFailed = new Promise<void>((resolve) => {
      failedOnce = resolve;
    });
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: async () => {
        claimCalls += 1;
        if (claimCalls === 1) return [runItem(1, ["/bin/echo", "hello"])];
        if (claimCalls === 2) {
          await reportFailed;
          throw new Error("fetch failed");
        }
        return new Promise<WorkItem[]>((resolve) => {
          drained = () => resolve([]);
        });
      },
      heartbeat: async () => {},
      drain: async () => drained(),
      report: async (input) => {
        reportCalls += 1;
        if (reportCalls === 1) {
          failedOnce();
          throw new Error("fetch failed");
        }
        reports.push(input.sequence);
      },
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(reports).toEqual([1]));
    await worker.drain();
    await running;
    expect(
      lines.some((line) => line.startsWith("could not report test-box#1 yet")),
      "the loss is said out loud rather than left to the lease",
    ).toBe(true);
  });

  /**
   * TEST_SCENARIO: A report can fail while the platform answers every claim, so
   * there is no reconnect to carry the result. The worker sends what it holds
   * before it takes more work, because the finished Job's lease runs out a
   * minute after its last heartbeat whether or not the worker is connected.
   */
  it("reports again before taking more work, without waiting for a reconnect", async () => {
    const queue = pollQueue();
    const reports: number[] = [];
    let connects = 0;
    let reportCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => {
        connects += 1;
        return { incarnation: "reg-1" };
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reportCalls += 1;
        if (reportCalls === 1) throw new Error("fetch failed");
        reports.push(input.sequence);
      },
    };
    const { worker } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([runItem(1, ["/bin/echo", "hello"])]);
    await vi.waitFor(() => expect(queue.polls).toHaveLength(2), {
      timeout: 3000,
    });
    queue.polls[1]?.resolve([]);
    await vi.waitFor(() => expect(reports).toEqual([1]), { timeout: 5000 });
    await worker.drain();
    await running;

    expect(connects, "a failed report alone does not reconnect").toBe(1);
  });

  /**
   * TEST_SCENARIO: A name can be registered again from another machine, whose
   * Job sequence starts at one. An outcome held from the old registration must
   * not be replayed onto the new one — it would settle an unrelated Job — so it
   * is dropped, and the drop is said out loud.
   */
  it("drops an outcome that belongs to a registration the platform replaced", async () => {
    const queue = pollQueue();
    const reports: number[] = [];
    const registrations = ["reg-1", "reg-2"];
    let connectCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => ({
        incarnation: registrations[connectCalls++] ?? "reg-2",
      }),
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reports.push(input.sequence);
        throw new Error("fetch failed");
      },
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([runItem(1, ["/bin/echo", "hello"])]);
    await vi.waitFor(() =>
      expect(
        lines.some((line) => line.startsWith("could not report test-box#1")),
      ).toBe(true),
    );
    queue.polls[1]?.reject(new Error("fetch failed"));
    await vi.waitFor(() =>
      expect(
        lines.some((line) =>
          line.startsWith("dropping the outcome of test-box#1"),
        ),
      ).toBe(true),
    );
    await worker.drain();
    await running;

    expect(
      reports,
      "the outcome never reaches a registration it was not claimed under",
    ).toEqual([1]);
  });

  /**
   * TEST_SCENARIO: A restarted MCP server can come back with a different set of
   * tools, and the platform's Snapshot is what an Agent is offered. The new
   * list is registered before the worker takes any more work, with the platform
   * answering every claim, so no reconnect is there to carry it.
   */
  it("registers a restarted MCP server's tool list before claiming more work", async () => {
    const queue = pollQueue();
    const connects: SatelliteManifest[] = [];
    const offered = [runTool(surface())];
    let current = offered;
    let died = false;
    const backend = {
      get tools() {
        return current;
      },
      ensureReady: async () => {
        if (!died) return { restarted: false };
        died = false;
        current = [];
        return { restarted: true, livedMs: 60_000 };
      },
      call: createCommandBackend(surface()).call,
      describeCall: () => "run",
      cancel: () => {},
      killAll: () => {},
      close: () => Promise.resolve(),
    };
    const transport: WorkerTransport = {
      connect: async (input) => {
        connects.push(input.manifest);
        return { incarnation: "reg-1" };
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async () => {},
    };
    const { worker } = workerWith(transport, backend);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    died = true;
    queue.polls[0]?.resolve([]);
    await vi.waitFor(() => expect(connects.length).toBe(2), { timeout: 4000 });
    await worker.drain();
    await running;

    expect(connects[0]?.tools).toEqual(offered);
    expect(connects[1]?.tools, "the new tool list is registered").toEqual([]);
  });

  /**
   * TEST_SCENARIO: A worker whose own MCP server will not start has nothing to
   * serve. Claiming work anyway leases Jobs to a machine that cannot run them,
   * and each one is reported back as interrupted, so readiness is retried
   * before any claim.
   */
  it("does not claim work while its MCP server is not ready", async () => {
    const queue = pollQueue();
    const violations: string[] = [];
    let ready = false;
    let ensureCalls = 0;
    const backend = {
      get tools() {
        return [runTool(surface())];
      },
      ensureReady: async () => {
        ensureCalls += 1;
        if (ensureCalls === 1)
          throw new Error("the MCP server would not start");
        ready = true;
        return { restarted: false };
      },
      call: createCommandBackend(surface()).call,
      describeCall: () => "run",
      cancel: () => {},
      killAll: () => {},
      close: () => Promise.resolve(),
    };
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: async () => {
        if (!ready) violations.push("claim before the machine was ready");
        return queue.binding();
      },
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async () => {},
    };
    const { worker } = workerWith(transport, backend);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    await worker.drain();
    await running;

    expect(violations).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A server that exits seconds after it starts is a crash loop,
   * and restarting it on every pass fills the log and the process table. Its
   * own backoff waits between restarts, which a server that ran a while does
   * not need.
   */
  it("waits before starting a crash-looping server again", async () => {
    const queue = pollQueue();
    const restarts: { livedMs: number }[] = [
      { livedMs: 60_000 },
      {
        livedMs: 5,
      },
    ];
    let died = false;
    const backend = {
      get tools() {
        return [runTool(surface())];
      },
      ensureReady: async () => {
        if (!died) return { restarted: false };
        died = false;
        return {
          restarted: true,
          ...(restarts.shift() as { livedMs: number }),
        };
      },
      call: createCommandBackend(surface()).call,
      describeCall: () => "run",
      cancel: () => {},
      killAll: () => {},
      close: () => Promise.resolve(),
    };
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async () => {},
    };
    const { worker, lines } = workerWith(transport, backend);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    died = true;
    queue.polls[0]?.resolve([]);
    await vi.waitFor(() => expect(queue.polls).toHaveLength(2), {
      timeout: 4000,
    });
    died = true;
    queue.polls[1]?.resolve([]);
    await vi.waitFor(
      () =>
        expect(
          lines.some((line) =>
            line.startsWith("the MCP server exited 0.0s after it started"),
          ),
        ).toBe(true),
      { timeout: 4000 },
    );
    await worker.drain();
    await running;

    expect(
      lines.filter((line) =>
        line.startsWith("the MCP server exited 0.0s after it started"),
      ),
      "a server that ran is not treated as a crash loop",
    ).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A worker that reconnects after its Satellite was removed has
   * only the registration it served, and the platform refuses it. Retrying that
   * fills the log with an error that never resolves, so it stops the same way a
   * refused claim does.
   */
  it("stops when the platform no longer holds the registration it served", async () => {
    const transport: WorkerTransport = {
      connect: async () => {
        throw new SatelliteRemovedError("test-box");
      },
      claim: async () => [],
      heartbeat: async () => {},
      drain: async () => {},
      report: async () => {},
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    const outcome = await Promise.race([
      running.then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
    ]);
    expect(outcome).toBe("stopped");
    expect(
      lines.some((line) => line.includes("was removed on the platform")),
    ).toBe(true);
  });

  /**
   * TEST_SCENARIO: A server from before the registration identity answers a
   * connect with no incarnation of its own. The worker already knows which
   * registration it serves, and that knowledge must not be replaced by nothing:
   * a rollout that lands the worker on an older replica would otherwise throw
   * away a result whose Job is still leased.
   */
  it("keeps the registration it knows when the server does not name one", async () => {
    const queue = pollQueue();
    const reports: number[] = [];
    let connectCalls = 0;
    let reportCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => {
        connectCalls += 1;
        return connectCalls === 1 ? { incarnation: "reg-1" } : undefined;
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reportCalls += 1;
        if (reportCalls === 1) throw new Error("fetch failed");
        reports.push(input.sequence);
      },
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([runItem(1, ["/bin/echo", "hello"])]);
    await vi.waitFor(() =>
      expect(
        lines.some((line) => line.startsWith("could not report test-box#1")),
      ).toBe(true),
    );
    queue.polls[1]?.reject(new Error("fetch failed"));
    await vi.waitFor(() => expect(reports).toEqual([1]), { timeout: 5000 });
    await worker.drain();
    await running;

    expect(
      lines.some((line) => line.startsWith("dropping the outcome")),
      "the same registration, so the result is still this worker's to send",
    ).toBe(false);
  });

  /**
   * TEST_SCENARIO: A worker that connected before the platform learned the
   * registration identity holds an untagged result. Once the platform names the
   * row's registration, that result is still the same row's, so it is sent
   * rather than discarded on a rollout in the other direction.
   */
  it("replays an untagged outcome once the server names the registration", async () => {
    const queue = pollQueue();
    const reports: { sequence: number; incarnation?: string }[] = [];
    let connectCalls = 0;
    let reportCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => {
        connectCalls += 1;
        return connectCalls === 1 ? undefined : { incarnation: "reg-1" };
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reportCalls += 1;
        if (reportCalls === 1) throw new Error("fetch failed");
        reports.push({
          sequence: input.sequence,
          ...(input.incarnation === undefined
            ? {}
            : { incarnation: input.incarnation }),
        });
      },
    };
    const { worker } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([runItem(1, ["/bin/echo", "hello"])]);
    await vi.waitFor(() => expect(reportCalls).toBe(1));
    queue.polls[1]?.reject(new Error("fetch failed"));
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 5000 });
    await worker.drain();
    await running;

    expect(reports[0]).toEqual({ sequence: 1, incarnation: "reg-1" });
  });

  /**
   * TEST_SCENARIO: A stop arrives while a claim is open, and the platform hands
   * work back anyway. Starting it would run a tool call nobody is waiting for on
   * a machine that is leaving, so the work is dropped and its lease runs out.
   */
  it("starts no work a claim hands back after a stop", async () => {
    const queue = pollQueue();
    const reports: number[] = [];
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => {},
      report: async (input) => {
        reports.push(input.sequence);
      },
    };
    const { worker, lines } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([
      runItem(1, ["/usr/bin/tail", "-f", "/etc/hosts"]),
    ]);
    await vi.waitFor(() => expect(queue.polls).toHaveLength(2));

    const draining = worker.drain();
    queue.polls[1]?.resolve([runItem(2, ["/bin/echo", "hello"])]);
    await vi.waitFor(() => expect(worker.runningCount).toBe(1));
    await worker.forceStop();
    await draining;
    await running;

    expect(
      lines.some((line) => line.startsWith("REQUEST #2")),
      "work returned after the stop is not started",
    ).toBe(false);
    expect(reports).not.toContain(2);
  });

  /**
   * TEST_SCENARIO: A reconnect finds the Satellite removed while a job is still
   * running on this machine. Closing the MCP server there would kill work the
   * architecture says finishes, so the removal drains exactly as a removed
   * claim does and the result is still reported.
   */
  it("drains a running job when a reconnect finds the satellite removed", async () => {
    const queue = pollQueue();
    const reports: number[] = [];
    const closed: string[] = [];
    let connectCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => {
        connectCalls += 1;
        if (connectCalls > 1) throw new SatelliteRemovedError("test-box");
        return { incarnation: "reg-1" };
      },
      claim: queue.binding,
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async (input) => {
        reports.push(input.sequence);
        closed.push("report");
      },
    };
    const parsed = parseCommandSurface(PATTERNS, IDENTITY);
    if (!parsed.ok) throw new Error(parsed.error);
    const backend = createCommandBackend(parsed.value);
    const { worker } = workerWith(transport, {
      ...backend,
      close: async () => {
        closed.push("close");
      },
    });

    const running = worker.start();
    await vi.waitFor(() => expect(queue.polls).toHaveLength(1));
    queue.polls[0]?.resolve([
      runItem(1, ["/usr/bin/tail", "-f", "/etc/hosts"]),
    ]);
    await vi.waitFor(() => expect(queue.polls).toHaveLength(2));
    queue.polls[1]?.reject(new Error("fetch failed"));
    await vi.waitFor(() => expect(connectCalls).toBeGreaterThanOrEqual(2));
    backend.cancel(1);
    await vi.waitFor(() => expect(reports).toEqual([1]));
    await running;

    expect(
      closed.indexOf("report"),
      "the job is reported before the machine's server is closed",
    ).toBeLessThan(closed.indexOf("close"));
  });

  /**
   * TEST_SCENARIO: A removal found by a claim leaves a result that cannot be
   * reported. Waiting on that report forever is the hang the drain grace exists
   * to prevent, so the worker stops on its own.
   */
  it("stops when a held result cannot be sent after the satellite was removed", async () => {
    const queue = pollQueue();
    let claimCalls = 0;
    let reportCalls = 0;
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: async () => {
        claimCalls += 1;
        if (claimCalls === 1) return [runItem(1, ["/bin/echo", "hello"])];
        if (claimCalls === 2) throw new SatelliteRemovedError("test-box");
        return queue.binding();
      },
      heartbeat: async () => {},
      drain: async () => {},
      report: async () => {
        reportCalls += 1;
        if (reportCalls === 1) throw new Error("fetch failed");
        return new Promise<never>(() => {});
      },
    };
    const { worker } = workerWith(transport);

    const outcome = await Promise.race([
      worker.start().then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 5000)),
    ]);
    expect(outcome).toBe("stopped");
  });

  /**
   * TEST_SCENARIO: A worker that runs for weeks completes millions of calls.
   * Each one racing the shutdown must not leave its losing subscription behind,
   * or the process grows until it is restarted for no reason.
   */
  it("keeps no shutdown subscription once a call has settled", async () => {
    const queue = pollQueue();
    let claims = 0;
    const transport: WorkerTransport = {
      connect: async () => ({ incarnation: "reg-1" }),
      claim: async () => {
        claims += 1;
        if (claims > 30) return queue.binding();
        return [runItem(claims, ["/bin/echo", "hello"])];
      },
      heartbeat: async () => {},
      drain: async () => queue.release(),
      report: async () => {},
    };
    const { worker } = workerWith(transport);

    const running = worker.start();
    await vi.waitFor(() => expect(claims).toBeGreaterThan(30), {
      timeout: 15_000,
    });
    expect(worker.waitingOnPlatform).toBeLessThanOrEqual(1);
    await worker.drain();
    await running;
  }, 30_000);

  /**
   * TEST_SCENARIO: A stop must not wait on a request that never answers. The
   * supervisor would kill the process instead of getting a clean stop, and the
   * drain already knows nothing is running.
   */
  it("stops without waiting for a platform call that never answers", async () => {
    const transport: WorkerTransport = {
      connect: () => new Promise<never>(() => {}),
      claim: async () => [],
      heartbeat: async () => {},
      drain: async () => {},
      report: async () => {},
    };
    const { worker } = workerWith(transport);

    const running = worker.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.drain();
    const outcome = await Promise.race([
      running.then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
    ]);
    expect(outcome).toBe("stopped");
  });

  /**
   * TEST_SCENARIO: A worker that is not signed in retries like any other drop,
   * but the line has to name the command that ends it. A service left running
   * with a revoked key would otherwise repeat a class name nobody can act on,
   * and the transport delivers the failure wrapped in its own error.
   */
  it("says what ends a missing sign-in instead of naming an error class", () => {
    expect(
      describeOffline(new AuthRequiredAtTransportError("session expired")),
    ).toContain("set DAM_TOKEN");
    expect(
      describeOffline(
        new Error("TRPCClientError", {
          cause: new AuthRequiredAtTransportError("session expired"),
        }),
      ),
      "the transport wraps the failure the worker has to name",
    ).toContain("set DAM_TOKEN");
    expect(describeOffline(new Error("fetch failed"))).toBe(
      "offline: Error: fetch failed",
    );
  });
});

describe("the wait before trying again", () => {
  it("doubles from the base to the cap and stays there", () => {
    const backoff = createBackoff({
      baseMs: 1_000,
      capMs: 30_000,
      random: () => 0.5,
    });
    expect(
      Array.from({ length: 7 }, () => backoff.next()),
      "a machine offline for a week still says so once every cap",
    ).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("spreads machines that start again together, within a fifth of the wait", () => {
    const lowest = createBackoff({ random: () => 0 });
    const highest = createBackoff({ random: () => 1 });
    expect(lowest.next()).toBe(800);
    expect(highest.next()).toBe(1_200);
  });

  it("starts over from the base once the platform answers", () => {
    const backoff = createBackoff({ random: () => 0.5 });
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(1_000);
  });
});
