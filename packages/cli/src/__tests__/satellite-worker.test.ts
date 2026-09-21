import { describe, expect, it } from "vitest";
import type { WorkItem } from "api-server-api";
import { parseManifest } from "../modules/satellite/domain/manifest.js";
import {
  createCommandBackend,
  runTool,
} from "../modules/satellite/services/command-backend.js";
import {
  createWorker,
  type WorkerTransport,
} from "../modules/satellite/services/worker.js";

/**
 * TEST_OVERVIEW: The satellite worker and the Manifest-backed backend, which is
 * where the allowlist is now enforced in full: the platform forwards a tool call
 * without reading its arguments, so the machine alone decides what may run on
 * it. These specs run real processes through that path — a permitted command
 * reports its exit code and output, a command the local Manifest does not permit
 * is refused without running, one that needs a human is held rather than run,
 * and several Jobs run at once. They also pin what the Manifest sends: cwd,
 * timeouts and the patterns themselves stay local, so the platform never learns
 * the machine's filesystem layout, and a malformed duration or a pattern that
 * would let the caller choose the program is rejected at load rather than at run
 * time.
 */

const MANIFEST = `
name = "test-box"
max_concurrent = 4

[[command]]
run = "/bin/echo (hello|goodbye)"
about = "Say something"

[[command]]
run = "/bin/tail -f /etc/hosts"

[[command]]
run = "/bin/sleep ^[1-9]$"
`;

/**
 * TEST_SCENARIO: The timeout is appended after the last [[command]] table, so
 * TOML attaches it to that command rather than to the satellite. Keep the
 * command the timeout spec runs last in MANIFEST.
 */
function manifest(timeout?: string) {
  const parsed = parseManifest(
    timeout === undefined ? MANIFEST : `${MANIFEST}\ntimeout = "${timeout}"\n`,
  );
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

  const parsed = manifest(timeout);
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

function runItem(sequence: number, cmd: string[], approved = false): WorkItem {
  return { kind: "call", sequence, tool: "run", args: { cmd }, approved };
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
    expect(report?.outcome.status).toBe("interrupted");
    if (report?.outcome.status !== "interrupted") return;
    expect(report.outcome.reason).toContain("refused locally");
  });

  it("refuses a program that appears in no pattern", async () => {
    const [report] = await drive([runItem(3, ["/bin/cat", "/etc/passwd"])]);
    expect(report?.outcome.status).toBe("interrupted");
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

describe("manifest parsing", () => {
  it("keeps cwd and timeouts local, pushing only what the platform must match on", () => {
    const parsed = parseManifest(`
name = "box"
cwd = "/srv"
timeout = "6h"
[[command]]
run = "./x ^[1-5]$"
cwd = "/tmp"
timeout = "30m"
approval = "always"
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.cwd).toBe("/srv");
    expect(parsed.value.timeoutMs).toBe(6 * 3_600_000);
    expect(parsed.value.commands[0]?.timeoutMs).toBe(30 * 60_000);
    expect(JSON.stringify(parsed.value.pushed)).not.toContain("/srv");
    expect(
      JSON.stringify(runTool(parsed.value)),
      "the tool describes the shapes but never the machine's layout",
    ).not.toContain("/srv");
  });

  it("rejects a manifest whose pattern lets the caller choose the program", () => {
    const parsed = parseManifest(`
name = "box"
[[command]]
run = "*"
`);
    expect(parsed.ok).toBe(false);
  });

  it("rejects a timeout the timer cannot hold, rather than killing the job at once", () => {
    const parsed = parseManifest(`
name = "box"
timeout = "999999h"
[[command]]
run = "./x"
`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("timeout");
  });

  it("rejects a malformed duration rather than guessing", () => {
    const parsed = parseManifest(`
name = "box"
timeout = "soon"
[[command]]
run = "./x"
`);
    expect(parsed.ok).toBe(false);
  });
});

describe("the manifest is checked against the contract before it is pushed", () => {
  it("refuses a name the server would refuse, on the machine", () => {
    const parsed = parseManifest(`
name = "Not A Valid Name"
[[command]]
run = "./x"
`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("name");
  });

  it("refuses a concurrency the server would refuse", () => {
    const parsed = parseManifest(`
name = "box"
max_concurrent = 0
[[command]]
run = "./x"
`);
    expect(parsed.ok).toBe(false);
  });
});

describe("reloading the manifest", () => {
  it("changes what the worker itself permits, not only what it pushed", async () => {
    const widened = parseManifest(`
name = "test-box"
max_concurrent = 4

[[command]]
run = "/bin/echo (hello|goodbye)"

[[command]]
run = "/bin/sleep ^[1-9]$"

[[command]]
run = "/bin/echo added-by-reload"
`);

    const { worker, backend, reports, allReported } = harness([
      runItem(1, ["/bin/echo", "added-by-reload"]),
    ]);
    if (widened.ok) backend.reload(widened.value);

    const running = worker.start();
    await allReported;
    await worker.drain();
    await running;

    expect(
      reports[0]?.outcome.status,
      "the server matched against the new manifest; the worker must too",
    ).toBe("done");
  });
});

describe("a reload that renames the satellite", () => {
  it("is refused before anything is pushed, because a rename is a different machine", () => {
    const renamed = parseManifest(`
name = "other-box"
[[command]]
run = "/bin/echo hello"
`);
    const { backend } = harness([]);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(backend.refusesReload(renamed.value)).toContain(
      "different satellite",
    );
  });

  it("is accepted when the name is unchanged", () => {
    const same = parseManifest(`
name = "test-box"
[[command]]
run = "/bin/echo hello"
`);
    const { backend } = harness([]);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(backend.refusesReload(same.value)).toBeNull();
  });
});

describe("the tools a manifest-backed satellite advertises", () => {
  it("offers exactly one tool, taking the command to run", () => {
    const tool = runTool(manifest());
    expect(tool.name).toBe("run");
    expect((tool.inputSchema as { required?: string[] }).required).toEqual([
      "cmd",
    ]);
  });

  it("carries the permitted shapes in the description, where a model reads them", () => {
    expect(runTool(manifest()).description).toContain(
      "/bin/echo (hello|goodbye)",
    );
  });
});

describe("a command the manifest holds for a human", () => {
  const HELD = `
name = "test-box"

[[command]]
run = "/bin/echo release-me"
approval = "always"
`;

  function heldHarness(items: WorkItem[]) {
    const reports: Reported[] = [];
    let handedOut = false;
    let resolveAll: () => void = () => {};
    const allReported = new Promise<void>((r) => {
      resolveAll = r;
    });
    const parsed = parseManifest(HELD);
    if (!parsed.ok) throw new Error(parsed.error);
    const backend = createCommandBackend(parsed.value, { line: () => {} });
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
    const worker = createWorker({
      name: "test-box",
      maxConcurrent: 4,
      backend,
      transport,
      log: { line: () => {} },
      host: "test-host",
    });
    return { worker, reports, allReported };
  }

  async function driveHeld(items: WorkItem[]): Promise<Reported[]> {
    const { worker, reports, allReported } = heldHarness(items);
    const running = worker.start();
    await allReported;
    await worker.drain();
    await running;
    return reports;
  }

  it("is held rather than run, because only the machine knows it needs one", async () => {
    const [report] = await driveHeld([runItem(1, ["/bin/echo", "release-me"])]);
    expect(report?.outcome.status).toBe("needs-approval");
  });

  it("runs once a human has allowed it, and is not asked about twice", async () => {
    const [report] = await driveHeld([
      runItem(1, ["/bin/echo", "release-me"], true),
    ]);
    expect(report?.outcome.status).toBe("done");
    if (report?.outcome.status !== "done") return;
    expect(report.outcome.output).toContain("release-me");
  });
});
