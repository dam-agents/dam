import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";

/**
 * TEST_OVERVIEW: Which registration of a Satellite a call belongs to. A name
 * outlives the row that holds it — removing a Satellite and registering the
 * same name again restarts its Job sequence at one — so every worker call names
 * the registration it serves, and the platform hands that name to the statement
 * that acts rather than checking it in an earlier read. A call whose
 * registration is not the one the row holds is refused before it can claim,
 * lease or settle anything.
 *
 * The statements themselves are exercised by their own SQL; what these specs
 * pin is that the identity travels into them at all, and that a worker which
 * names nothing keeps working as it did before the identity existed.
 */

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";

function satellite(patch: Partial<SatelliteRow> = {}): SatelliteRow {
  return {
    owner: "alice",
    name: "gpu-box",
    description: null,
    host: "gpu-box.internal",
    maxConcurrent: 4,
    tools: [{ name: "run", inputSchema: { type: "object" } }],
    draining: false,
    lastSeenAt: new Date(),
    incarnation: OLD,
    createdAt: new Date("2026-09-17T12:00:00Z"),
    ...patch,
  };
}

function harness(repo: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, result: unknown = null) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return result;
    };
  const worker = createSatelliteWorkerOps({
    repo: {
      get: record("get", satellite()),
      settle: record("settle"),
      claimQueued: record("claimQueued", []),
      takeCancellations: record("takeCancellations", []),
      renewLeases: record("renewLeases"),
      touch: record("touch"),
      setDraining: record("setDraining"),
      upsertFromManifest: record("upsertFromManifest", { incarnation: OLD }),
      renewFromManifest: record("renewFromManifest", { incarnation: OLD }),
      ...repo,
    } as never,
    maxConcurrentCeiling: 8,
    deliverOutcome: async () => {},
  });
  return { worker, calls };
}

function done(incarnation?: string) {
  return {
    satellite: "gpu-box",
    sequence: 1,
    ...(incarnation === undefined ? {} : { incarnation }),
    outcome: {
      status: "done" as const,
      isError: false,
      exitCode: 0,
      output: "all good",
      images: [],
      truncated: false,
    },
  };
}

function manifest() {
  return {
    name: "gpu-box",
    maxConcurrent: 4,
    tools: [{ name: "run", inputSchema: { type: "object" } }],
  };
}

describe("a satellite's registration", () => {
  it("puts the registration in the statement that settles a job", async () => {
    const { worker, calls } = harness();
    await worker.report("alice", done(OLD));
    expect(
      calls.settle?.[0]?.at(-1),
      "the settle itself is fenced, not a read before it",
    ).toBe(OLD);
  });

  it("records an outcome only for this registration's job", async () => {
    const { worker } = harness({ settle: async () => null });
    await worker.report("alice", done(OLD));
  });

  /**
   * TEST_SCENARIO: A CLI from before the registration identity sends no
   * incarnation. It cannot be fenced, and refusing it would break every old
   * worker on the deployment, so the legacy path stays open and settles by name
   * and sequence as it always did.
   */
  it("settles a report from a worker that names no registration", async () => {
    const { worker, calls } = harness();
    await worker.report("alice", done());
    expect(calls.settle?.[0]?.at(-1)).toBeUndefined();
  });

  it("registers a name no worker has served before", async () => {
    const { worker, calls } = harness();
    await expect(worker.connect("alice", manifest(), "host")).resolves.toEqual({
      incarnation: OLD,
    });
    expect(calls.upsertFromManifest).toHaveLength(1);
    expect(calls.renewFromManifest).toBeUndefined();
  });

  it("renews only the registration a worker names", async () => {
    const { worker, calls } = harness();
    await worker.connect("alice", manifest(), "host", OLD);
    expect(calls.renewFromManifest?.[0]?.at(-1)).toBe(OLD);
    expect(calls.upsertFromManifest).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A worker that was away while its Satellite was removed, or
   * registered again from another machine, must not take the name back: the
   * renewal writes nothing and the answer is that there is no such Satellite.
   */
  it("refuses a worker whose registration the platform no longer holds", async () => {
    const { worker, calls } = harness({ renewFromManifest: async () => null });
    await expect(
      worker.connect("alice", manifest(), "host", OLD),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(calls.upsertFromManifest).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A long poll is open when the Satellite is removed and
   * registered again from another machine. The poll must not take the
   * replacement's work: the registration is read again on every iteration, and
   * a claim for another one is refused rather than answered.
   */
  it("refuses a claim whose registration was replaced during the poll", async () => {
    let reads = 0;
    const { worker } = harness({
      get: async () => {
        reads += 1;
        return satellite({ incarnation: reads > 1 ? NEW : OLD });
      },
    });
    await expect(
      worker.claim("alice", {
        satellite: "gpu-box",
        capacity: 2,
        waitMs: 5_000,
        incarnation: OLD,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(reads, "the registration is checked again on each iteration").toBe(
      2,
    );
  });

  it("claims with the registration the poll was opened under", async () => {
    const { worker, calls } = harness();
    await worker.claim("alice", {
      satellite: "gpu-box",
      capacity: 2,
      waitMs: 0,
      incarnation: OLD,
    });
    expect(calls.claimQueued?.[0]?.at(-1)).toBe(OLD);
  });

  it("claims by name for a worker that names no registration", async () => {
    const { worker, calls } = harness();
    await worker.claim("alice", {
      satellite: "gpu-box",
      capacity: 2,
      waitMs: 0,
    });
    expect(calls.claimQueued?.[0]?.at(-1)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A removal and a re-registration are one click apart, so two
   * registrations of one name can be created in the same millisecond. Their
   * identity cannot be the row's creation time — it is a value of its own — so a
   * worker of the first one is refused even when the second row's timestamp is
   * identical.
   */
  it("tells apart registrations created at the same moment", async () => {
    const created = new Date("2026-10-01T00:00:00Z");
    const { worker } = harness({
      get: async () =>
        satellite({ incarnation: NEW, createdAt: new Date(created) }),
    });
    await expect(
      worker.heartbeat("alice", {
        satellite: "gpu-box",
        running: [1],
        incarnation: OLD,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("refuses a heartbeat from a replaced registration", async () => {
    const { worker, calls } = harness({
      get: async () => satellite({ incarnation: NEW }),
    });
    await expect(
      worker.heartbeat("alice", {
        satellite: "gpu-box",
        running: [1],
        incarnation: OLD,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(calls.renewLeases, "nothing of the replacement's is renewed").toBe(
      undefined,
    );
  });

  it("refuses a drain from a replaced registration", async () => {
    const { worker, calls } = harness({
      get: async () => satellite({ incarnation: NEW }),
    });
    await expect(worker.drain("alice", "gpu-box", OLD)).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(calls.setDraining).toBeUndefined();
  });
});
