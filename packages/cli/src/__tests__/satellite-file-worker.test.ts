import { TRPCClientError } from "@trpc/client";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FileResultInput,
  FileWorkItem,
  SatelliteManifest,
  WorkItem,
} from "api-server-api";
import {
  createFileOps,
  type FileOpAnswer,
  type FileOps,
} from "../modules/satellite/services/file-ops.js";
import {
  createFileWorker,
  describeFilesOffline,
} from "../modules/satellite/services/file-worker.js";
import type { FileWorkerTransport } from "../modules/satellite/services/worker.js";

/**
 * TEST_OVERVIEW: The files worker, as the platform sees it. It registers a
 * manifest with no tools and a `files` block, claims File Operations beside Jobs,
 * runs up to `maxConcurrent` at once, answers each by its own id in the
 * registration it was queued for, and prints a summary a minute with counts and
 * no path. An operation past its deadline is answered without touching the
 * machine, and one that throws is one failed operation rather than a stopped
 * worker.
 */

const FAST = { baseMs: 1, capMs: 2 };

afterEach(() => {
  vi.restoreAllMocks();
});
const INCARNATION = "33333333-3333-4333-8333-333333333333";
const OPERATION = "44444444-4444-4444-8444-444444444444";

function item(patch: Partial<FileWorkItem> = {}): FileWorkItem {
  return {
    kind: "file",
    id: OPERATION,
    op: "getattr",
    path: ".",
    remainingMs: 30_000,
    deadline: Date.now() + 30_000,
    agent: { id: "agent-1a2b", name: "Builder" },
    ...patch,
  };
}

function fake(result: (request: { op: string }) => FileOpAnswer): FileOps {
  return {
    run: async (request) => result(request),
  };
}

describe("the files worker", () => {
  /**
   * TEST_SCENARIO: A files Satellite offers one directory and no tools, and the
   * worker that serves it answers an operation by the id it was claimed under,
   * naming the registration it serves so the platform can tell it from another
   * machine's.
   */
  it("registers a mount and answers each operation in the registration it was queued for", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "dam-files-worker-")),
    );
    try {
      const results: FileResultInput[] = [];
      const manifests: SatelliteManifest[] = [];
      const lines: string[] = [];
      let finish: () => void = () => {};
      const answered = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let release: () => void = () => {};
      let claims = 0;
      const transport: FileWorkerTransport = {
        connect: async ({ manifest }) => {
          manifests.push(manifest);
          return { incarnation: INCARNATION };
        },
        claim: async () => {
          if (claims++ === 0) return [item()];
          return new Promise<WorkItem[]>((resolve) => {
            release = () => resolve([]);
          });
        },
        heartbeat: async () => {},
        drain: async () => release(),
        fileResult: async (input) => {
          results.push(input);
          finish();
        },
      };
      const worker = createFileWorker({
        name: "lab",
        root,
        writable: true,
        maxConcurrent: 2,
        host: "machine",
        ops: createFileOps({ root, writable: true }),
        transport,
        log: { line: (line) => lines.push(line) },
        retry: FAST,
      });

      const running = worker.start();
      await answered;
      await worker.drain();
      await running;

      expect(manifests[0]).toEqual({
        name: "lab",
        kind: "files",
        maxConcurrent: 2,
        tools: [],
        files: { writable: true },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        satellite: "lab",
        id: OPERATION,
        incarnation: INCARNATION,
        ok: true,
      });
      expect(lines).toContain('connected as "lab" — files:');
      expect(lines).toContain(`  ${root} — read and write`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * TEST_SCENARIO: An operation carries the instant its Agent stops waiting, as a
   * duration the machine counts down itself. One that reaches the machine with none
   * of it left is answered EIO without touching the machine, so a change never lands
   * after the Agent was told it failed.
   */
  it("answers EIO for an operation past its deadline and touches nothing", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "dam-files-worker-")),
    );
    try {
      const results: FileResultInput[] = [];
      const lines: string[] = [];
      let finish: () => void = () => {};
      const answered = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let release: () => void = () => {};
      let claims = 0;
      const transport: FileWorkerTransport = {
        connect: async () => ({ incarnation: INCARNATION }),
        claim: async () => {
          if (claims++ === 0)
            return [
              item({
                op: "create",
                path: "late.txt",
                args: { mode: 0o644, exclusive: true },
                remainingMs: 0,
              }),
            ];
          return new Promise<WorkItem[]>((resolve) => {
            release = () => resolve([]);
          });
        },
        heartbeat: async () => {},
        drain: async () => release(),
        fileResult: async (input) => {
          results.push(input);
          finish();
        },
      };
      const worker = createFileWorker({
        name: "lab",
        root,
        writable: true,
        maxConcurrent: 1,
        host: "machine",
        ops: createFileOps({ root, writable: true }),
        transport,
        log: { line: (line) => lines.push(line) },
        retry: FAST,
      });

      const running = worker.start();
      await answered;
      await worker.drain();
      await running;

      expect(results[0]).toMatchObject({ ok: false, errno: "EIO" });
      await expect(lstat(join(root, "late.txt"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * TEST_SCENARIO: The platform's epoch and the machine's clock need not agree, and a
   * machine whose clock is a day ahead must not throw away work that still has time.
   * The wait is what the claim carried as a duration, counted down here, so the
   * operation runs and its deadline is this machine's own.
   */
  it("counts the wait down on this machine's clock, not the platform's", async () => {
    const day = 24 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + day);
    const seen: number[] = [];
    const results: FileResultInput[] = [];
    let finish: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let release: () => void = () => {};
    let claims = 0;
    const transport: FileWorkerTransport = {
      connect: async () => ({ incarnation: INCARNATION }),
      claim: async () => {
        if (claims++ === 0)
          return [item({ remainingMs: 30_000, deadline: Date.now() - day })];
        return new Promise<WorkItem[]>((resolve) => {
          release = () => resolve([]);
        });
      },
      heartbeat: async () => {},
      drain: async () => release(),
      fileResult: async (input) => {
        results.push(input);
        finish();
      },
    };
    const worker = createFileWorker({
      name: "lab",
      root: "/srv/lab",
      writable: false,
      maxConcurrent: 1,
      host: "machine",
      ops: {
        run: async (request) => {
          seen.push(request.deadline - Date.now());
          return { ok: true, result: {} };
        },
      },
      transport,
      log: { line: () => {} },
      retry: FAST,
    });

    const running = worker.start();
    await answered;
    await worker.drain();
    await running;

    expect(results[0]).toMatchObject({ ok: true });
    expect(seen[0]).toBeGreaterThan(29_000);
    expect(seen[0]).toBeLessThanOrEqual(30_000);
  });

  /**
   * TEST_SCENARIO: `--max-concurrent` counts operations in flight on a files
   * worker: while the slots are taken the worker does not claim, and the next
   * claim offers the capacity that is left.
   */
  it("claims with the capacity its in-flight operations leave", async () => {
    const capacities: number[] = [];
    const results: FileResultInput[] = [];
    const gates: (() => void)[] = [];
    let release: () => void = () => {};
    let finish: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transport: FileWorkerTransport = {
      connect: async () => ({ incarnation: INCARNATION }),
      claim: async ({ capacity }) => {
        capacities.push(capacity);
        if (capacities.length === 1)
          return [item({ id: "77777777-7777-4777-8777-777777777777" })];
        if (capacities.length === 2)
          return [item({ id: "88888888-8888-4888-8888-888888888888" })];
        return new Promise<WorkItem[]>((resolve) => {
          release = () => resolve([]);
        });
      },
      heartbeat: async () => {},
      drain: async () => release(),
      fileResult: async (input) => {
        results.push(input);
        if (results.length === 2) finish();
      },
    };
    const worker = createFileWorker({
      name: "lab",
      root: "/srv/lab",
      writable: true,
      maxConcurrent: 2,
      host: "machine",
      ops: {
        run: () =>
          new Promise<FileOpAnswer>((resolve) => {
            gates.push(() => resolve({ ok: true }));
          }),
      },
      transport,
      log: { line: () => {} },
      retry: FAST,
    });

    const running = worker.start();
    await vi.waitFor(() => expect(capacities).toHaveLength(2));
    expect(capacities).toEqual([2, 1]);
    for (const open of gates) open();
    await answered;
    await worker.drain();
    await running;
    expect(capacities).not.toContain(0);
  });

  /**
   * TEST_SCENARIO: AC-12 at the worker. The client prints one summary per minute
   * from its own counters: operations, files opened by identity, bytes and the
   * entries it created, renamed and deleted — and never a path.
   */
  it("summarizes a minute with counts and no path", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "dam-files-worker-")),
    );
    try {
      const lines: string[] = [];
      const results: FileResultInput[] = [];
      const queued: FileWorkItem[] = [
        item({
          id: OPERATION,
          op: "read",
          path: "secret/a.txt",
          args: { offset: 0, size: 4, dev: 7, ino: 9 },
        }),
        item({
          id: "55555555-5555-4555-8555-555555555555",
          op: "write",
          path: "secret/a.txt",
          args: { offset: 0, dev: 7, ino: 9 },
          data: Buffer.from("ab").toString("base64"),
        }),
        item({
          id: "66666666-6666-4666-8666-666666666666",
          op: "unlink",
          path: "secret/a.txt",
        }),
      ];
      let finish: () => void = () => {};
      const answered = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let release: () => void = () => {};
      let taken = false;
      const transport: FileWorkerTransport = {
        connect: async () => ({ incarnation: INCARNATION }),
        claim: async () => {
          if (!taken) {
            taken = true;
            return queued;
          }
          return new Promise<WorkItem[]>((resolve) => {
            release = () => resolve([]);
          });
        },
        heartbeat: async () => {},
        drain: async () => release(),
        fileResult: async (input) => {
          results.push(input);
          if (results.length === queued.length) finish();
        },
      };
      const worker = createFileWorker({
        name: "lab",
        root,
        writable: true,
        maxConcurrent: 4,
        host: "machine",
        ops: fake((request) =>
          request.op === "read"
            ? { ok: true, data: Buffer.from("data").toString("base64") }
            : { ok: true, result: {} },
        ),
        transport,
        log: { line: (line) => lines.push(line) },
        retry: FAST,
      });

      const running = worker.start();
      await answered;
      worker.summary();
      await worker.drain();
      await running;

      const summary = lines.find((line) => line.startsWith("SUMMARY lab:"));
      expect(summary).toBe(
        "SUMMARY lab: 3 ops, 1 files opened, 4 bytes read, 2 bytes written, 0 created, 0 renamed, 1 deleted",
      );
      expect(summary).not.toContain("a.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * TEST_SCENARIO: An operation claimed in the moment the worker is told to stop is
   * answered "Host is down" through the same request its answer would have taken, so
   * the Agent's tools stop waiting at once instead of at their deadline.
   */
  it("answers an operation claimed while stopping with Host is down", async () => {
    const results: FileResultInput[] = [];
    const lines: string[] = [];
    let started = false;
    let release: (items: WorkItem[]) => void = () => {};
    const transport: FileWorkerTransport = {
      connect: async () => ({ incarnation: INCARNATION }),
      claim: () => {
        started = true;
        return new Promise<WorkItem[]>((resolve) => {
          release = resolve;
        });
      },
      heartbeat: async () => {},
      drain: async () => {},
      fileResult: async (input) => {
        results.push(input);
      },
    };
    const worker = createFileWorker({
      name: "lab",
      root: "/srv/lab",
      writable: false,
      maxConcurrent: 1,
      host: "machine",
      ops: { run: async () => ({ ok: true, result: {} }) },
      transport,
      log: { line: (line) => lines.push(line) },
      retry: FAST,
    });

    const running = worker.start();
    await vi.waitFor(() => expect(started).toBe(true));
    void worker.drain();
    release([item()]);
    await running;

    expect(results[0]).toMatchObject({ ok: false, errno: "EHOSTDOWN" });
    expect(lines.some((line) => line.includes("Host is down"))).toBe(true);
  });

  /**
   * TEST_SCENARIO: Something unexpected is one failed operation: the worker
   * answers EIO for it and keeps serving, because a stopped service costs every
   * Agent its mount.
   */
  it("answers EIO when an operation throws and keeps the worker running", async () => {
    const results: FileResultInput[] = [];
    let finish: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let release: () => void = () => {};
    let claims = 0;
    const transport: FileWorkerTransport = {
      connect: async () => ({ incarnation: INCARNATION }),
      claim: async () => {
        if (claims++ === 0) return [item()];
        return new Promise<WorkItem[]>((resolve) => {
          release = () => resolve([]);
        });
      },
      heartbeat: async () => {},
      drain: async () => release(),
      fileResult: async (input) => {
        results.push(input);
        finish();
      },
    };
    const worker = createFileWorker({
      name: "lab",
      root: "/srv/lab",
      writable: false,
      maxConcurrent: 1,
      host: "machine",
      ops: {
        run: async () => {
          throw new Error("the disk went away");
        },
      },
      transport,
      log: { line: () => {} },
      retry: FAST,
    });

    const running = worker.start();
    await answered;
    await vi.waitFor(() => expect(worker.inFlightCount).toBe(0));
    await worker.drain();
    await running;

    expect(results[0]).toMatchObject({ ok: false, errno: "EIO" });
  });
});

describe("a files worker on a platform that predates the mount", () => {
  /**
   * TEST_SCENARIO: AC-14's other half. The platform's manifest schema requires at
   * least one tool, so it refuses a file tree by naming the manifest's `tools`. That
   * is not a manifest to fix but a platform to upgrade, so the worker prints the
   * upgrade and stops instead of retrying a schema that will never accept it.
   */
  it("stops with the upgrade message when the platform's schema has no file tree", async () => {
    const refusal = Object.assign(
      new TRPCClientError("manifest rejected") as TRPCClientError<never>,
      {
        data: {
          code: "BAD_REQUEST",
          zodError: {
            issues: [
              {
                code: "too_small",
                path: ["manifest", "tools"],
                message: "Array must contain at least 1 element(s)",
              },
            ],
          },
        },
      },
    );
    let connects = 0;
    const transport: FileWorkerTransport = {
      connect: async () => {
        connects += 1;
        throw refusal;
      },
      claim: async () => [],
      heartbeat: async () => {},
      drain: async () => {},
      fileResult: async () => {},
    };
    const worker = createFileWorker({
      name: "lab",
      root: "/srv/lab",
      writable: false,
      maxConcurrent: 1,
      host: "machine",
      ops: { run: async () => ({ ok: true }) },
      transport,
      log: { line: () => {} },
      retry: FAST,
    });

    await expect(worker.start()).rejects.toThrow(
      /this platform does not support satellite files mounts yet — upgrade the platform/,
    );
    expect(connects).toBe(1);
    expect(describeFilesOffline(refusal)).toContain(
      "this platform does not support satellite files mounts yet — upgrade the platform",
    );
  });

  /**
   * TEST_SCENARIO: A refusal about this manifest's own content is not an old
   * platform, and the user needs the server's words rather than a wrong upgrade
   * suggestion: the reason carries them through unchanged.
   */
  it("surfaces the server's own words for a manifest it refused", () => {
    const refusal = Object.assign(
      new TRPCClientError("manifest rejected") as TRPCClientError<never>,
      {
        data: {
          code: "BAD_REQUEST",
          zodError: {
            issues: [{ code: "too_big", path: ["manifest", "description"] }],
          },
        },
      },
    );
    const reason = describeFilesOffline(refusal);
    expect(reason).toContain("manifest rejected");
    expect(reason).not.toContain("does not support satellite files mounts yet");
    expect(describeFilesOffline(new Error("socket hang up"))).toContain(
      "offline:",
    );
  });
});
