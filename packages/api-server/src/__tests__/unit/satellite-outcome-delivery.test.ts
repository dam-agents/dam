import { describe, expect, it, vi } from "vitest";
import { createOutcomeDelivery } from "../../modules/satellites/services/outcome-delivery.js";
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
    cmd: ["./process.sh", "sales.db"],
    pattern: "./process.sh (sales.db|events.db)",
    status: "done",
    approvalId: null,
    exitCode: 0,
    output: "all good",
    truncated: false,
    reason: null,
    cancelRequested: false,
    deliveredAt: null,
    startedAt: new Date(),
    endedAt: new Date(),
    createdAt: new Date(),
    ...patch,
  };
}

function harness(claimed: JobRow[][]) {
  const events: { agentId: string; payload: unknown }[] = [];
  const woken: string[] = [];
  let call = 0;
  const deliver = createOutcomeDelivery({
    repo: {
      claimUndeliveredOutcomes: async () => claimed[call++] ?? [],
      agentsWithPendingOutcomes: async () => [],
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
  return { deliver, events, woken };
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
      repo: { claimUndeliveredOutcomes: async () => [job()] } as never,
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
