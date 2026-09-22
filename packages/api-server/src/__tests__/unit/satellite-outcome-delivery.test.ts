import { describe, expect, it } from "vitest";
import {
  createOutcomeDelivery,
  createOutcomeWakeRetry,
} from "../../modules/satellites/services/outcome-delivery.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";
import type { JobRow } from "../../modules/satellites/domain/types.js";

/**
 * TEST_OVERVIEW: Wake on finish. A Job outlives the turn that started it, so a
 * terminal outcome wakes the Agent with a synthetic prompt carrying what the
 * wait tool would have returned. Two rules keep that from becoming noise, and
 * both are load-bearing because there is no opt-out: an outcome already
 * delivered never wakes, so an Agent sitting in wait does not also get a second
 * turn about the same Job; and simultaneous finishes coalesce into one turn
 * through a single atomic claim rather than a timer. A large Job Log is handed
 * over as a path into the Agent's own sandbox instead of being inlined, and an
 * Agent that cannot be woken — parked over budget — still keeps its turn queued.
 */

function job(patch: Partial<JobRow> = {}): JobRow {
  return {
    owner: "alice",
    satellite: "gpu-box",
    sequence: 7,
    agentId: "agent-1",
    tool: "run",
    args: { cmd: ["./process.sh", "sales.db"] },
    status: "done",
    isError: false,
    exitCode: 0,
    output: "all good",
    truncated: false,
    reason: null,
    cancelRequested: false,
    cancelSentAt: null,
    deliveredAt: null,
    wokeAt: null,
    awaitedUntil: null,
    startedAt: new Date(),
    endedAt: new Date(),
    createdAt: new Date(),
    ...patch,
  };
}

function harness(claimed: JobRow[][]) {
  const events: { agentId: string; payload: unknown }[] = [];
  const woken: string[] = [];
  const released: number[] = [];
  let call = 0;
  const deliver = createOutcomeDelivery({
    repo: {
      claimUndeliveredOutcomes: async () => claimed[call++] ?? [],
      releaseOutcomes: async (_o: string, _s: string, sequences: number[]) => {
        released.push(...sequences);
      },
      agentsWithPendingOutcomes: async () => [],
      markWoken: async () => {},
      undeliveredFor: async () => [],
    } as never,
    bump: async (agentId, list) => {
      for (const e of list) events.push({ agentId, payload: e.payload });
      return 1;
    },
    enqueue: async () => {},
    wakeAgent: async (agentId) => {
      woken.push(agentId);
    },
    spillLog: async (_agent, ref) =>
      `/home/agent/.dam/satellite-jobs/${ref}.log`,
    log: () => {},
  });
  return { deliver, events, woken, released };
}

function task(payload: unknown): string {
  return (payload as { task: string }).task;
}

describe("waking an agent with a finished job", () => {
  it("sends one turn carrying the outcome, and wakes the agent", async () => {
    const { deliver, events, woken } = harness([[job()]]);
    expect(await deliver("agent-1")).toBe(true);
    expect(events).toHaveLength(1);
    expect(task(events[0]?.payload)).toContain("gpu-box#7");
    expect(task(events[0]?.payload)).toContain("exit 0");
    expect(task(events[0]?.payload)).toContain("all good");
    expect(woken).toEqual(["agent-1"]);
  });

  it("carries why a job ended and what it printed, not one or the other", async () => {
    const { deliver, events } = harness([
      [
        job({
          status: "cancelled",
          exitCode: null,
          reason: "cancelled before it started",
          output: "rows written: 4021",
        }),
      ],
    ]);
    await deliver("agent-1");
    const text = task(events[0]?.payload);
    expect(text).toContain("cancelled before it started");
    expect(
      text,
      "a killed job's output is the only record of what it did before it died",
    ).toContain("rows written: 4021");
  });

  it("coalesces simultaneous finishes into a single turn", async () => {
    const { deliver, events } = harness([
      [job({ sequence: 7 }), job({ sequence: 8 }), job({ sequence: 9 })],
    ]);
    await deliver("agent-1");
    expect(events).toHaveLength(1);
    const text = task(events[0]?.payload);
    expect(text).toContain("3 satellite jobs");
    for (const ref of ["gpu-box#7", "gpu-box#8", "gpu-box#9"])
      expect(text).toContain(ref);
  });

  it("tells the agent only what fits, and leaves the rest claimable", async () => {
    const big = "x".repeat(4000);
    const { deliver, events, released } = harness([
      Array.from({ length: 40 }, (_, i) =>
        job({ sequence: i + 1, output: big }),
      ),
    ]);
    await deliver("agent-1");
    const text = task(events[0]?.payload);
    expect(text.length).toBeLessThan(80_000);
    expect(
      released.length,
      "a row claimed but trimmed out of the turn would never be told",
    ).toBeGreaterThan(0);
    for (const sequence of released)
      expect(text).not.toContain(`gpu-box#${sequence} `);
  });

  it("does not wake for an outcome already delivered", async () => {
    const { deliver, events, woken } = harness([[]]);
    expect(await deliver("agent-1")).toBe(false);
    expect(events).toHaveLength(0);
    expect(woken).toHaveLength(0);
  });

  it("hands over a path instead of the text when the log is large", async () => {
    const { deliver, events } = harness([[job({ output: "x".repeat(5000) })]]);
    await deliver("agent-1");
    const text = task(events[0]?.payload);
    expect(text).toContain(".dam/satellite-jobs/gpu-box#7.log");
    expect(text).not.toContain("x".repeat(5000));
  });

  it("reports an interrupted job by its reason rather than pretending it finished", async () => {
    const { deliver, events } = harness([
      [
        job({
          status: "interrupted",
          exitCode: null,
          output: null,
          reason: "lost its worker; the command may have completed",
        }),
      ],
    ]);
    await deliver("agent-1");
    const text = task(events[0]?.payload);
    expect(text).toContain("interrupted");
    expect(text).toContain("may have completed");
  });

  it("still records the turn when the agent cannot be woken", async () => {
    const events: unknown[] = [];
    const deliver = createOutcomeDelivery({
      repo: {
        claimUndeliveredOutcomes: async () => [job()],
        markWoken: async () => {},
      } as never,
      bump: async (_agentId, list) => {
        events.push(...list);
        return 1;
      },
      enqueue: async () => {},
      wakeAgent: async () => {
        throw new Error("over budget");
      },
      spillLog: async () => null,
      log: () => {},
    });
    expect(await deliver("agent-1")).toBe(true);
    expect(events).toHaveLength(1);
  });
});

describe("reporting an outcome reaches the wake", () => {
  it("leaves the claim to delivery, so a reported job still wakes the agent", async () => {
    const rows = [job({ status: "running", deliveredAt: null })];
    const repo = {
      settle: async () => {
        rows[0] = { ...rows[0]!, status: "done" };
        return rows[0]!;
      },
      claimUndeliveredOutcomes: async () => {
        const undelivered = rows.filter((r) => r.deliveredAt === null);
        rows[0] = { ...rows[0]!, deliveredAt: new Date() };
        return undelivered;
      },
      markWoken: async () => {},
      touch: async () => {},
    };
    const events: unknown[] = [];
    const deliver = createOutcomeDelivery({
      repo: repo as never,
      bump: async (_agentId, list) => {
        events.push(...list);
        return 1;
      },
      enqueue: async () => {},
      wakeAgent: async () => {},
      spillLog: async () => null,
      log: () => {},
    });

    const workerOps = createSatelliteWorkerOps({
      repo: repo as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async ({ agentId }) => {
        await deliver(agentId);
      },
    });

    await workerOps.report("alice", {
      satellite: "gpu-box",
      sequence: 7,
      outcome: {
        status: "done",
        isError: false,
        exitCode: 0,
        output: "ok",
        truncated: false,
      },
    });

    expect(
      events,
      "report must not consume the claim delivery needs",
    ).toHaveLength(1);
  });
});

describe("an agent that could not be woken", () => {
  it("stays findable by the retry, because the wake is recorded apart from the claim", async () => {
    const woken: string[] = [];
    const stamped: { satellite: string; sequence: number }[][] = [];
    let wakeWorks = false;
    const deliver = createOutcomeDelivery({
      repo: {
        claimUndeliveredOutcomes: async () => [job()],
        markWoken: async (_agentId: string, refs: never[]) => {
          stamped.push(refs);
        },
      } as never,
      bump: async () => 1,
      enqueue: async () => {},
      wakeAgent: async (agentId) => {
        if (!wakeWorks) throw new Error("over budget");
        woken.push(agentId);
      },
      spillLog: async () => null,
      log: () => {},
    });

    expect(await deliver("agent-1")).toBe(true);
    expect(woken, "the agent was over budget").toEqual([]);
    expect(
      stamped,
      "nothing may be stamped woken when no wake happened",
    ).toEqual([]);

    wakeWorks = true;
    const retry = createOutcomeWakeRetry(
      {
        repo: {
          agentsWithPendingOutcomes: async () => ["agent-1"],
          undeliveredFor: async () => [{ satellite: "gpu-box", sequence: 7 }],
          markWoken: async (_agentId: string, refs: never[]) => {
            stamped.push(refs);
          },
        } as never,
        bump: async () => 1,
        enqueue: async () => {},
        wakeAgent: async (agentId) => {
          woken.push(agentId);
        },
        spillLog: async () => null,
        log: () => {},
      },
      async () => false,
    );

    await retry();
    expect(
      woken,
      "the hourly sweep must reach it once the budget frees",
    ).toEqual(["agent-1"]);
    expect(stamped[0]).toEqual([{ satellite: "gpu-box", sequence: 7 }]);
  });
});

describe("one job owes one turn", () => {
  it("keeps the claim when the turn was written but the enqueue failed", async () => {
    const released: number[] = [];
    const deliver = createOutcomeDelivery({
      repo: {
        claimUndeliveredOutcomes: async () => [job()],
        markWoken: async () => {},
        releaseOutcomes: async (
          _o: string,
          _s: string,
          sequences: number[],
        ) => {
          released.push(...sequences);
        },
      } as never,
      bump: async () => 1,
      enqueue: async () => {
        throw new Error("redis is down");
      },
      wakeAgent: async () => {},
      spillLog: async () => null,
      log: () => {},
    });

    expect(await deliver("agent-1")).toBe(true);
    expect(
      released,
      "the event is durable once bump commits; releasing would announce it twice",
    ).toEqual([]);
  });

  it("releases the claim when no turn was written at all", async () => {
    const released: number[] = [];
    const deliver = createOutcomeDelivery({
      repo: {
        claimUndeliveredOutcomes: async () => [job()],
        markWoken: async () => {},
        releaseOutcomes: async (
          _o: string,
          _s: string,
          sequences: number[],
        ) => {
          released.push(...sequences);
        },
      } as never,
      bump: async () => {
        throw new Error("postgres is down");
      },
      enqueue: async () => {},
      wakeAgent: async () => {},
      spillLog: async () => null,
      log: () => {},
    });

    expect(await deliver("agent-1")).toBe(false);
    expect(
      released,
      "nothing was written, so it must be announceable again",
    ).toEqual([7]);
  });
});

describe("the hourly sweep", () => {
  it("announces an outcome nobody claimed, rather than waking an agent with nothing to read", async () => {
    const announced: string[] = [];
    const woken: string[] = [];
    const retry = createOutcomeWakeRetry(
      {
        repo: {
          agentsWithPendingOutcomes: async () => ["agent-1"],
          undeliveredFor: async () => [],
          markWoken: async () => {},
        } as never,
        bump: async () => 1,
        enqueue: async () => {},
        wakeAgent: async (agentId) => {
          woken.push(agentId);
        },
        spillLog: async () => null,
        log: () => {},
      },
      async (agentId) => {
        announced.push(agentId);
        return true;
      },
    );

    await retry();
    expect(announced).toEqual(["agent-1"]);
    expect(
      woken,
      "announcing already wakes; a bare wake would find nothing",
    ).toEqual([]);
  });
});

describe("the sweep never wakes blindly", () => {
  it("skips an agent whose outcome was released, leaving it to be announced", async () => {
    const woken: string[] = [];
    const retry = createOutcomeWakeRetry(
      {
        repo: {
          agentsWithPendingOutcomes: async () => ["agent-1"],
          undeliveredFor: async () => [],
          markWoken: async () => {},
        } as never,
        bump: async () => 1,
        enqueue: async () => {},
        wakeAgent: async (agentId) => {
          woken.push(agentId);
        },
        spillLog: async () => null,
        log: () => {},
      },
      async () => false,
    );

    await retry();
    expect(woken, "no turn exists, so a wake would find nothing").toEqual([]);
  });
});
