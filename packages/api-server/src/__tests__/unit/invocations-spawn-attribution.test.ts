import { describe, expect, test } from "vitest";

import type { InvocationsRepository } from "../../modules/invocations/infrastructure/invocations-repository.js";
import {
  createInvocationsService,
  UnresolvableDriverError,
} from "../../modules/invocations/services/invocations-service.js";

// The security-load-bearing spawn guarantees (#3041): a target has no spend
// identity of its own, so spawn resolves the root Driver and stamps it as the
// target's `telemetryAttributionId`. A chain that cannot resolve fails CLOSED —
// stamping self would manufacture exactly the orphan spend row this feature
// eliminates — so spawn refuses before any row or agent exists.

interface Recorder {
  inserted: string[];
  deleted: string[];
  created: Array<Record<string, unknown>>;
}

function makeService(opts: {
  resolveRoot: (id: string) => Promise<string | null>;
}) {
  const rec: Recorder = { inserted: [], deleted: [], created: [] };
  const repo: InvocationsRepository = {
    insert: async (row) => {
      rec.inserted.push(row.id);
    },
    get: async () => null,
    complete: async () => true,
    fail: async () => {},
    listExpiredRunning: async () => [],
    listRunning: async () => [],
    listRunningByDriver: async () => [],
    listRunningAgentIds: async () => [],
    listTargetsByOwner: async () => [],
    listAgedTerminal: async () => [],
    listByExperiment: async () => [],
    countRunningByDriver: async () => new Map(),
    failAllRunningByExperiment: async () => [],
    delete: async (id) => {
      rec.deleted.push(id);
    },
  };
  const service = createInvocationsService({
    owner: "owner-1",
    repo,
    agents: {
      create: async (input: Record<string, unknown>) => {
        rec.created.push(input);
        return { id: input.id as string };
      },
      delete: async () => {},
    } as never,
    driverResolution: { resolveRoot: opts.resolveRoot },
    runtimeMutator: {
      bump: async () => 0,
      enqueueAfterCommit: async () => {},
    } as never,
    wakeAgent: async () => {},
  });
  return { rec, service };
}

const spawnInput = {
  driverAgentId: "driver-1",
  driverGrantIds: [],
  connections: [],
  prompt: "do the thing",
  schema: { type: "object" },
};

describe("spawn attributes spend to the resolved root Driver", () => {
  test("the resolved root id is stamped as the target's telemetryAttributionId", async () => {
    const { rec, service } = makeService({
      resolveRoot: async () => "root-agent",
    });
    await service.spawn(spawnInput);
    expect(rec.created).toHaveLength(1);
    expect(rec.created[0]?.telemetryAttributionId).toBe("root-agent");
  });

  test("an unresolvable driver chain fails closed with UnresolvableDriverError and leaves no row or agent", async () => {
    const { rec, service } = makeService({ resolveRoot: async () => null });
    await expect(service.spawn(spawnInput)).rejects.toBeInstanceOf(
      UnresolvableDriverError,
    );
    // Fail at the door: resolution precedes the row, so nothing to clean up.
    expect(rec.inserted).toEqual([]);
    expect(rec.created).toEqual([]);
    expect(rec.deleted).toEqual([]);
  });
});
