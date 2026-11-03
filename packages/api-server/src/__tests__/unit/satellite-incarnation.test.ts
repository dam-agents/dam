import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";

/**
 * TEST_OVERVIEW: Which registration of a Satellite a call belongs to. A name
 * outlives the row that holds it — removing a Satellite and registering the
 * same name again restarts its Job sequence at one — so a worker's late report
 * is matched against the registration it served, and a worker that names a
 * registration the platform no longer holds is told there is no such Satellite
 * instead of taking the name over.
 */

const CREATED = new Date("2026-09-17T12:00:00Z");
const INCARNATION = CREATED.toISOString();

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
    createdAt: CREATED,
    ...patch,
  };
}

function harness(repo: Record<string, unknown>) {
  const settled: number[] = [];
  const registered: number[] = [];
  const worker = createSatelliteWorkerOps({
    repo: {
      settle: async (_owner: string, _name: string, sequence: number) => {
        settled.push(sequence);
        return null;
      },
      upsertFromManifest: async () => {
        registered.push(1);
        return { incarnation: INCARNATION };
      },
      ...repo,
    } as never,
    maxConcurrentCeiling: 8,
    deliverOutcome: async () => {},
  });
  return { worker, settled, registered };
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

describe("a satellite's registration", () => {
  it("settles a report that names the registration it was claimed under", async () => {
    const { worker, settled } = harness({ get: async () => satellite() });
    await worker.report("alice", done(INCARNATION));
    expect(settled).toEqual([1]);
  });

  /**
   * TEST_SCENARIO: Jobs are deleted with a Satellite and the sequence starts
   * over, so the old machine's #1 and the new machine's #1 are different Jobs.
   * Replaying the old outcome would settle a Job this worker never ran.
   */
  it("ignores a report claimed under a registration the platform replaced", async () => {
    const { worker, settled } = harness({
      get: async () =>
        satellite({ createdAt: new Date("2026-10-01T00:00:00Z") }),
    });
    await worker.report("alice", done(INCARNATION));
    expect(settled, "the old registration's outcome settles nothing").toEqual(
      [],
    );
  });

  it("registers a name no worker has served before", async () => {
    const { worker, registered } = harness({ get: async () => null });
    await expect(worker.connect("alice", manifest(), "host")).resolves.toEqual({
      incarnation: INCARNATION,
    });
    expect(registered).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A worker that was serving this Satellite and comes back
   * after it was removed must not register it again: the removal was the
   * owner's decision, and registering again would undo it without anyone
   * asking. A fresh worker names no registration and is free to take the name.
   */
  it("refuses a worker that names a registration the platform no longer holds", async () => {
    const { worker, registered } = harness({ get: async () => null });
    await expect(
      worker.connect("alice", manifest(), "host", INCARNATION),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(registered, "a removed Satellite is not registered again").toEqual(
      [],
    );
  });

  it("refuses a worker that names a registration another machine replaced", async () => {
    const { worker, registered } = harness({
      get: async () =>
        satellite({ createdAt: new Date("2026-10-01T00:00:00Z") }),
    });
    await expect(
      worker.connect("alice", manifest(), "host", INCARNATION),
    ).rejects.toThrow(/registered again/);
    expect(registered).toEqual([]);
  });
});

function manifest() {
  return {
    name: "gpu-box",
    maxConcurrent: 4,
    tools: [{ name: "run", inputSchema: { type: "object" } }],
  };
}
