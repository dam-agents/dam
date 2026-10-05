import { describe, expect, it } from "vitest";
import {
  CLAIM_LEASE_MS,
  createSubAgentOutcomeDelivery,
  createSubAgentOutcomeWakeRetry,
  type SubAgentOutcomeDeliveryDeps,
} from "../../modules/invocations/services/outcome-delivery.js";
import type { InvocationRow } from "../../modules/invocations/infrastructure/invocations-repository.js";

/**
 * TEST_OVERVIEW: An outcome nobody awaited is delivered as one turn per Driver,
 * and one outcome owes one turn and loses none. The claim is a lease, and a row
 * counts as delivered only once its turn is written, so a bump that fails
 * releases the rows for the next tick; outcomes past one turn's budget are
 * released too. A stopped Driver is not woken behind the user's back: its turn
 * waits in the outbox and the rows are marked woken so the hourly retry leaves
 * it alone. The retry only wakes; announcing again would owe two turns.
 */

const NOW = new Date("2026-10-05T12:00:00Z");

function row(patch: Partial<InvocationRow> = {}): InvocationRow {
  return {
    id: "agent-child1",
    driverAgentId: "agent-driver",
    rootDriverId: "agent-driver",
    owner: "alice",
    label: null,
    prompt: "do it",
    templateId: null,
    image: null,
    connections: [],
    cpu: null,
    memory: null,
    ttlMs: null,
    resultSchema: { type: "integer" },
    result: 42,
    status: "done",
    errorReason: null,
    createdAt: NOW,
    expiresAt: NOW,
    completedAt: NOW,
    reapedAt: null,
    transcriptCaptured: false,
    transcriptTruncated: false,
    harnessConfig: null,
    ...patch,
  };
}

function harness(opts: {
  claimed?: InvocationRow[][];
  unwoken?: InvocationRow[];
  bumpFails?: boolean;
  releaseFailsFor?: string[];
  stopped?: string[];
}) {
  const bumps: { agentId: string; payload: { ids: string[]; task: string } }[] =
    [];
  const released: string[][] = [];
  const delivered: string[][] = [];
  const woken: string[][] = [];
  const wakes: string[] = [];
  const enqueued: string[] = [];
  const claims: Date[] = [];
  const logs: string[] = [];
  let call = 0;
  const deps: SubAgentOutcomeDeliveryDeps = {
    repo: {
      markAwaited: async () => {},
      markCollected: async () => {},
      claimUndelivered: async (_limit, until) => {
        claims.push(until);
        return opts.claimed?.[call++] ?? [];
      },
      release: async (ids) => {
        if (ids.some((id) => opts.releaseFailsFor?.includes(id)))
          throw new Error("release boom");
        released.push(ids);
      },
      markDelivered: async (ids) => {
        delivered.push(ids);
      },
      markWoken: async (ids) => {
        woken.push(ids);
      },
      listDeliveredUnwoken: async () => opts.unwoken ?? [],
    },
    bump: async (agentId, events) => {
      if (opts.bumpFails) throw new Error("outbox boom");
      for (const e of events)
        bumps.push({
          agentId,
          payload: e.payload as { ids: string[]; task: string },
        });
      return events.length;
    },
    enqueue: async (agentId) => {
      enqueued.push(agentId);
    },
    agentStopped: async (agentId) => opts.stopped?.includes(agentId) ?? false,
    wakeAgent: async (agentId) => {
      wakes.push(agentId);
    },
    log: (msg) => {
      logs.push(msg);
    },
    now: () => NOW,
  };
  return {
    deliver: createSubAgentOutcomeDelivery(deps),
    retry: createSubAgentOutcomeWakeRetry(deps),
    bumps,
    released,
    delivered,
    woken,
    wakes,
    enqueued,
    claims,
    logs,
  };
}

describe("one turn per driver", () => {
  it("tells a driver about every claimed child in one turn and wakes it", async () => {
    const h = harness({
      claimed: [
        [
          row({ id: "agent-a", label: "six" }),
          row({ id: "agent-b", status: "failed", errorReason: "oom" }),
        ],
      ],
    });
    expect(await h.deliver()).toBe(1);
    expect(h.bumps).toHaveLength(1);
    expect(h.bumps[0]!.payload.ids).toEqual(["agent-a", "agent-b"]);
    expect(h.bumps[0]!.payload.task).toContain("2 sub-agents you spawned");
    expect(h.bumps[0]!.payload.task).toContain("six (agent-a) — done");
    expect(h.bumps[0]!.payload.task).toContain("agent-b — failed: oom");
    expect(h.delivered).toEqual([["agent-a", "agent-b"]]);
    expect(h.enqueued).toEqual(["agent-driver"]);
    expect(h.wakes).toEqual(["agent-driver"]);
    expect(h.woken).toEqual([["agent-a", "agent-b"]]);
  });

  it("writes one turn for each driver with claimed children", async () => {
    const h = harness({
      claimed: [
        [
          row({ id: "agent-a", driverAgentId: "agent-d1" }),
          row({ id: "agent-b", driverAgentId: "agent-d2" }),
        ],
      ],
    });
    expect(await h.deliver()).toBe(2);
    expect(h.bumps.map((b) => b.agentId)).toEqual(["agent-d1", "agent-d2"]);
  });

  it("leases the claim for one lease from the current time", async () => {
    const h = harness({ claimed: [[]] });
    await h.deliver();
    expect(h.claims).toEqual([new Date(NOW.getTime() + CLAIM_LEASE_MS)]);
  });
});

describe("one outcome owes one turn", () => {
  it("releases the rows and marks nothing delivered when the turn cannot be written", async () => {
    const h = harness({ claimed: [[row()]], bumpFails: true });
    expect(await h.deliver()).toBe(0);
    expect(h.released).toEqual([[], ["agent-child1"]]);
    expect(h.delivered).toEqual([]);
    expect(h.wakes).toEqual([]);
    expect(h.woken).toEqual([]);
  });

  it("releases the children past one turn's budget for the next tick", async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      row({ id: `agent-${String(i).padStart(2, "0")}` }),
    );
    const h = harness({ claimed: [rows] });
    await h.deliver();
    expect(h.bumps[0]!.payload.ids).toHaveLength(20);
    expect(h.released).toEqual([["agent-20"]]);
    expect(h.delivered[0]).toHaveLength(20);
  });

  it("goes on to the next driver when one driver's release throws", async () => {
    const rows = [
      ...Array.from({ length: 21 }, (_, i) =>
        row({ id: `agent-a${String(i).padStart(2, "0")}` }),
      ),
      row({ id: "agent-b", driverAgentId: "agent-d2" }),
    ];
    const h = harness({ claimed: [rows], releaseFailsFor: ["agent-a20"] });
    expect(await h.deliver()).toBe(1);
    expect(h.bumps.map((b) => b.agentId)).toEqual(["agent-d2"]);
    expect(h.logs.some((l) => l.includes("skipped agent-driver"))).toBe(true);
  });
});

describe("a stop wins over the wake", () => {
  it("writes the turn but does not wake a stopped driver, and marks the rows woken", async () => {
    const h = harness({ claimed: [[row()]], stopped: ["agent-driver"] });
    expect(await h.deliver()).toBe(1);
    expect(h.bumps).toHaveLength(1);
    expect(h.delivered).toEqual([["agent-child1"]]);
    expect(h.wakes).toEqual([]);
    expect(h.woken).toEqual([["agent-child1"]]);
    expect(h.logs.some((l) => l.includes("is stopped"))).toBe(true);
  });
});

describe("the hourly retry", () => {
  it("only wakes a driver whose turn is written, and never announces again", async () => {
    const h = harness({
      unwoken: [
        row({ id: "agent-a", driverAgentId: "agent-d1" }),
        row({ id: "agent-b", driverAgentId: "agent-d1" }),
        row({ id: "agent-c", driverAgentId: "agent-d2" }),
      ],
    });
    expect(await h.retry()).toBe(2);
    expect(h.bumps).toEqual([]);
    expect(h.wakes).toEqual(["agent-d1", "agent-d2"]);
    expect(h.woken).toEqual([["agent-a", "agent-b"], ["agent-c"]]);
  });

  it("leaves a stopped driver down and stops retrying it", async () => {
    const h = harness({ unwoken: [row()], stopped: ["agent-driver"] });
    await h.retry();
    expect(h.wakes).toEqual([]);
    expect(h.woken).toEqual([["agent-child1"]]);
  });

  it("keeps the rows for the next hour when the wake throws", async () => {
    const h = harness({ unwoken: [row()] });
    const failing = createSubAgentOutcomeWakeRetry({
      repo: {
        markAwaited: async () => {},
        markCollected: async () => {},
        claimUndelivered: async () => [],
        release: async () => {},
        markDelivered: async () => {},
        markWoken: async (ids) => {
          h.woken.push(ids);
        },
        listDeliveredUnwoken: async () => [row()],
      },
      bump: async () => 0,
      enqueue: async () => {},
      agentStopped: async () => false,
      wakeAgent: async () => {
        throw new Error("over budget");
      },
      log: () => {},
    });
    await failing();
    expect(h.woken).toEqual([]);
  });
});
