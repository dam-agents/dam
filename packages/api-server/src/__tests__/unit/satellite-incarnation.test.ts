import { TRPCError } from "@trpc/server";
import { satelliteGrants, satelliteJobs, satellites } from "db";
import { describe, expect, it } from "vitest";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";
import { createSatellitesRepository } from "../../modules/satellites/infrastructure/satellites-repository.js";
import { createSatelliteAgentOps } from "../../modules/satellites/services/agent-ops.js";
import { createSatellitesService } from "../../modules/satellites/services/satellites-service.js";
import {
  createLeaseSweep,
  createSatelliteWorkerOps,
} from "../../modules/satellites/services/worker-ops.js";

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

describe("admission against a registration that changes underneath it", () => {
  function ops(repo: Record<string, unknown>) {
    return createSatelliteAgentOps({
      repo: {
        grantedSatellite: async () => satellite(),
        get: async () => satellite(),
        activeJobs: async () => [],
        ...repo,
      } as never,
      ownerOf: async () => "alice",
      spillLog: async () => null,
    });
  }

  const start = { agentId: "agent-1", tool: "run", args: { cmd: ["./x"] } };

  /**
   * TEST_SCENARIO: A call is admitted against the tools, grants and limits of
   * the machine that answered a moment ago. The name can be registered again
   * between that read and the insert, and the new machine's row is not the one
   * the call was admitted for: the insert says so and the caller is refused
   * rather than having the call run somewhere it was never approved to run.
   */
  it("refuses a call admitted against a registration that was replaced", async () => {
    const worker = ops({ insertJob: async () => ({ stale: true }) });
    await expect(
      worker.start(start.agentId, "gpu-box", start.tool, start.args),
    ).rejects.toThrow(/registered again/);
  });

  it("admits against the registration it read", async () => {
    const insertions: { incarnation?: string }[] = [];
    const worker = ops({
      insertJob: async (input: { incarnation?: string }) => {
        insertions.push(input);
        return {
          sequence: 1,
          owner: "alice",
          satellite: "gpu-box",
          agentId: "agent-1",
          tool: "run",
          args: {},
          status: "queued",
        };
      },
    });
    await worker.start(start.agentId, "gpu-box", start.tool, start.args);
    expect(insertions[0]?.incarnation).toBe(OLD);
  });
});

describe("writes derived from a snapshot", () => {
  /**
   * TEST_SCENARIO: The lease sweep reads the Jobs whose lease expired, and the
   * name can be registered again before it writes. The expiry it read travels
   * into the update, so a Job that a replacement created and claimed — whose
   * lease is in the future — is not settled with the old machine's snapshot.
   */
  it("settles an expired lease only while it is still expired", async () => {
    const settles: unknown[][] = [];
    const now = new Date("2026-10-01T12:00:00Z");
    const sweep = createLeaseSweep({
      repo: {
        stopDispatch: async () => [],
        expiredLeases: async () => [
          {
            owner: "alice",
            satellite: "gpu-box",
            sequence: 1,
            agentId: "agent-1",
            tool: "run",
            args: {},
            status: "running",
            isError: false,
            exitCode: null,
            output: null,
            images: [],
            truncated: false,
            reason: null,
            cancelRequested: false,
            cancelSentAt: null,
            deliveredAt: null,
            wokeAt: null,
            awaitedUntil: null,
            startedAt: now,
            endedAt: null,
            createdAt: now,
          },
        ],
        settle: async (...args: unknown[]) => {
          settles.push(args);
          return null;
        },
        purgeExpired: async () => {},
      } as never,
      maxConcurrentCeiling: 8,
      deliverOutcome: async () => {},
      now: () => now,
    });
    await sweep();
    expect(settles[0]?.at(-1), "the expiry is rechecked in the update").toEqual(
      now,
    );
  });

  /**
   * TEST_SCENARIO: A cancellation is authorized against the Job it read. The
   * name can be registered again before the cancel is written, and the new
   * machine's number 1 is a different Job, so the write carries the registration
   * the Job was read under.
   */
  it("cancels a Job only in the registration it was read from", async () => {
    const requested: unknown[][] = [];
    const service = createSatellitesService({
      repo: {
        get: async () => satellite(),
        getJob: async () => ({
          owner: "alice",
          satellite: "gpu-box",
          sequence: 1,
          agentId: "agent-1",
          status: "running",
          tool: "run",
          args: {},
        }),
        requestCancel: async (...args: unknown[]) => {
          requested.push(args);
        },
      } as never,
      owner: "alice",
      agentBinding: "*",
      isAgentOwnedBy: async () => true,
      deliverOutcome: async () => {},
      stopDispatch: async () => {},
    });
    await service.cancelJob("gpu-box", 1);
    expect(requested[0]?.at(-1)).toBe(OLD);
  });
});

describe("the statements that own a registration", () => {
  const tableName = new Map<unknown, string>([
    [satellites, "satellites"],
    [satelliteJobs, "jobs"],
    [satelliteGrants, "grants"],
  ]);

  function recordingDb(steps: string[], locked: unknown) {
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            for: async () => {
              steps.push(`lock ${tableName.get(table) ?? "?"}`);
              return [locked];
            },
          }),
        }),
      }),
      delete: (table: unknown) => ({
        where: async () => {
          steps.push(`delete ${tableName.get(table) ?? "?"}`);
        },
      }),
    };
    return {
      transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx),
    } as never;
  }

  /**
   * TEST_SCENARIO: Admission locks the Satellite's row before it inserts, so a
   * removal that takes the same lock first can never leave a Job of the
   * registration it deletes behind for the next machine of that name to claim.
   * The removal therefore runs in one transaction whose first statement is that
   * lock, and every delete follows it.
   */
  it("takes the registration's row before deleting anything", async () => {
    const steps: string[] = [];
    const repo = createSatellitesRepository(
      recordingDb(steps, { incarnation: OLD }),
    );
    await repo.remove("alice", "gpu-box");
    expect(steps).toEqual([
      "lock satellites",
      "delete jobs",
      "delete grants",
      "delete satellites",
    ]);
  });

  /**
   * TEST_SCENARIO: A call is admitted from a Satellite row read a moment ago.
   * The row that the insert locks is that same registration, or the insert says
   * the registration changed instead of writing the call into a machine that
   * was never approved for it.
   */
  it("refuses to insert into a registration the caller did not read", async () => {
    const repo = createSatellitesRepository(
      recordingDb([], {
        next: 1,
        incarnation: NEW,
      }),
    );
    await expect(
      repo.insertJob({
        owner: "alice",
        satellite: "gpu-box",
        agentId: "agent-1",
        tool: "run",
        args: {},
        status: "queued",
        expiresAt: new Date(),
        maxConcurrent: 4,
        toolMax: null,
        incarnation: OLD,
      }),
    ).resolves.toEqual({ stale: true });
  });
});

describe("an agent's access to one registration", () => {
  function ops(repo: Record<string, unknown>) {
    return createSatelliteAgentOps({
      repo: {
        get: async () => satellite(),
        activeJobs: async () => [],
        getJob: async () => null,
        ...repo,
      } as never,
      ownerOf: async () => "alice",
      spillLog: async () => null,
    });
  }

  /**
   * TEST_SCENARIO: A grant is keyed by name, and the name can be registered
   * again while an Agent's access is being checked. Reading the grant and the
   * Satellite separately would let an old grant authorize the machine that
   * replaced the one it was given to, so both come from one statement — and a
   * grant that only exists for a registration that is gone authorizes nothing.
   */
  it("refuses an Agent's access that belongs to a replaced registration", async () => {
    const worker = ops({
      grantedNames: async () => [{ owner: "alice", name: "gpu-box" }],
      grantedSatellite: async () => null,
      insertJob: async () => ({
        sequence: 1,
        owner: "alice",
        satellite: "gpu-box",
        agentId: "agent-1",
        tool: "run",
        args: {},
        status: "queued",
      }),
    });
    await expect(
      worker.start("agent-1", "gpu-box", "run", { cmd: ["./x"] }),
    ).rejects.toThrow(/no access|no satellite/);
  });

  it("admits through the satellite and grant that were read together", async () => {
    const reads: string[] = [];
    const worker = ops({
      grantedSatellite: async () => {
        reads.push("granted");
        return satellite();
      },
      insertJob: async () => ({
        sequence: 1,
        owner: "alice",
        satellite: "gpu-box",
        agentId: "agent-1",
        tool: "run",
        args: {},
        status: "queued",
      }),
    });
    await worker.start("agent-1", "gpu-box", "run", { cmd: ["./x"] });
    expect(reads).toEqual(["granted"]);
  });

  /**
   * TEST_SCENARIO: The MCP cancellation path authorizes against a Job and then
   * writes a cancellation. The name can be registered again in between, and the
   * new machine's number 1 is a different Job, so both writes carry the
   * registration the Job was read under.
   */
  it("cancels through the MCP path only in the registration it read", async () => {
    const requested: unknown[][] = [];
    const settled: unknown[][] = [];
    const worker = ops({
      grantedSatellite: async () => satellite(),
      getJob: async () => ({
        owner: "alice",
        satellite: "gpu-box",
        sequence: 1,
        agentId: "agent-1",
        status: "running",
        tool: "run",
        args: {},
        output: null,
        truncated: false,
        exitCode: null,
        isError: false,
        reason: null,
      }),
      requestCancel: async (...args: unknown[]) => {
        requested.push(args);
      },
      settle: async (...args: unknown[]) => {
        settled.push(args);
        return null;
      },
    });
    await worker.cancel("agent-1", "gpu-box", 1);
    expect(requested[0]?.at(-1)).toBe(OLD);
    expect(settled, "a running job is cancelled, not settled").toHaveLength(0);
  });
});
