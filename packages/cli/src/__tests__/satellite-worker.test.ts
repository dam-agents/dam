import { describe, expect, it } from "vitest";
import type { WorkItem } from "api-server-api";
import { parseManifest } from "../modules/satellite/domain/manifest.js";
import {
  createWorker,
  type WorkerTransport,
} from "../modules/satellite/services/worker.js";

/**
 * TEST_OVERVIEW: The satellite worker, which is where the allowlist is actually
 * enforced. The machine does not delegate to the cluster the question of what
 * may run on it: the server matched the command already, and the worker matches
 * it again against the Manifest on its own disk before spawning anything. These
 * specs run real processes through that path — a permitted command reports its
 * exit code and output, a command the local Manifest does not permit is refused
 * without running, and several Jobs run at once. They also pin what the Manifest
 * sends: cwd and timeouts stay local, so the platform never learns the machine's
 * filesystem layout, and a malformed duration or a pattern that would let the
 * caller choose the program is rejected at load rather than at run time.
 */

const MANIFEST = `
name = "test-box"
max_concurrent = 4

[[command]]
run = "/bin/echo (hello|goodbye)"
about = "Say something"

[[command]]
run = "/bin/sleep ^[1-9]$"
`;

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

  const worker = createWorker({
    manifest: manifest(timeout),
    transport,
    log: { line: () => {} },
    host: "test-host",
  });
  return { worker, reports, allReported };
}

function runItem(sequence: number, cmd: string[]): WorkItem {
  return { kind: "run", sequence, cmd, timeoutMs: null };
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
    const { worker, reports, allReported } = harness([
      runItem(1, ["/bin/sleep", "9"]),
    ]);
    const running = worker.start();
    await new Promise((r) => setTimeout(r, 300));
    worker.cancel(1);
    await allReported;
    await worker.drain();
    await running;
    expect(reports[0]?.outcome.status).toBe("cancelled");
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
    expect(parsed.value.pushed.commands[0]).toEqual({
      run: "./x ^[1-5]$",
      approval: "always",
    });
    expect(JSON.stringify(parsed.value.pushed)).not.toContain("/srv");
  });

  it("rejects a manifest whose pattern lets the caller choose the program", () => {
    const parsed = parseManifest(`
name = "box"
[[command]]
run = "*"
`);
    expect(parsed.ok).toBe(false);
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
