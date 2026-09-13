// TEST_OVERVIEW: what the scheduler does with an agent no node holds. Assignment is easy to check by reading the code; the state an agent is left in when it fits nowhere is not, and getting it wrong strands the agent — it reads as coming up for ever, and a stop request has nothing to act on because no supervisor owns it.
import { describe, expect, it } from "vitest";
import type {
  AgentRecord,
  AgentStatus,
} from "../../modules/agents/infrastructure/agent-store.js";
import { createScheduler } from "../../modules/nodes/services/scheduler.js";

const LAST_ACTIVITY = "agent-platform.ai/last-activity";

function record(over: Partial<AgentRecord>): AgentRecord {
  return {
    id: "agent-1",
    owner: "sub-1",
    annotations: { [LAST_ACTIVITY]: new Date().toISOString() },
    spec: { image: "img", resources: { limits: { cpu: "1", memory: "1Gi" } } },
    status: {},
    assignedNode: null,
    lastNode: null,
    ...over,
  } as AgentRecord;
}

function harness(
  records: AgentRecord[],
  nodes: { id: string; cpuMilli: number; memoryBytes: number }[],
  ceiling: { cpu: string; memory: string } = { cpu: "64", memory: "128Gi" },
) {
  const assigns: [string, string | null][] = [];
  const statuses: [string, AgentStatus][] = [];
  const scheduler = createScheduler({
    store: {
      list: async () => records,
      assign: async (id: string, node: string | null) => {
        assigns.push([id, node]);
        return null;
      },
      writeStatus: async (id: string, patch: AgentStatus) => {
        statuses.push([id, patch]);
        return null;
      },
    } as never,
    registry: { ready: async () => nodes } as never,
    defaultIdleTimeoutMs: 60_000,
    ceilingFor: async () => ceiling,
    log: () => {},
  });
  return { scheduler, assigns, statuses };
}

const BIG = { cpu: "8", memory: "16Gi" };
const SMALL_NODE = { id: "node-1", cpuMilli: 4000, memoryBytes: 8 * 1024 ** 3 };

describe("placing agents on nodes", () => {
  it("leaves an agent that fits nowhere unassigned", async () => {
    const { scheduler, assigns } = harness(
      [record({ spec: { image: "img", resources: { limits: BIG } } as never })],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(assigns).toEqual([]);
  });

  // TEST_SCENARIO: the agent above, once it is asked to stop. No node holds it, so no supervisor will ever tear it down and publish that it is at rest — and the readiness its last run published is still on the record.
  it("retires the readiness of an agent no node holds", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: { ready: true, address: "100.64.0.2:8080" },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses).toEqual([
      [
        "agent-1",
        expect.objectContaining({
          ready: false,
          hibernated: true,
          address: "",
        }),
      ],
    ]);
  });

  // TEST_SCENARIO: an agent that arrived from a migration and has never run. Its status says nothing at all, which reads the same as one being built right now — but nothing is building it, because it is on no node and is not asking to run.
  it("says an agent that never ran and is not wanted is at rest", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: {},
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses).toEqual([
      ["agent-1", expect.objectContaining({ ready: false, hibernated: true })],
    ]);
  });

  // TEST_SCENARIO: an agent that could not be placed and has since been stopped. The reason it could not be placed describes an attempt nobody is making any more, and left behind it reads as a live complaint about a machine that is no longer being asked for anything.
  it("drops the placement complaint when the agent goes to rest", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: { noCapacityMessage: "no node has room" },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses[0]?.[1]).toMatchObject({
      hibernated: true,
      noCapacityMessage: "",
    });
  });

  // TEST_SCENARIO: a resting agent that already says it is resting but still carries a complaint about capacity — the shape a record takes if the complaint outlived the placement attempt. The state machine reads the complaint first, so leaving it there would report a machine shortage for an agent nobody is asking for.
  it("still clears a stale complaint from an agent already at rest", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: { hibernated: true, noCapacityMessage: "no node has room" },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses[0]?.[1]).toMatchObject({ noCapacityMessage: "" });
  });

  it("says nothing about an agent already at rest", async () => {
    const { scheduler, statuses, assigns } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: { ready: false, hibernated: true },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses).toEqual([]);
    expect(assigns).toEqual([]);
  });

  // TEST_SCENARIO: an agent asking to run that fits nowhere. Nothing else in the system will say so — the supervisor never sees it, because it was never assigned — so it reads as coming up for as long as anyone watches it.
  it("says on the record why it could not place an agent", async () => {
    const { scheduler, statuses } = harness(
      [record({ spec: { image: "img", resources: { limits: BIG } } as never })],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.[1].noCapacityMessage).toMatch(
      /asks for 16.0 Gi of memory and the largest node has 8.0 Gi/,
    );
  });

  // TEST_SCENARIO: an agent that would fit on an empty node but not on this one, which a neighbour is already holding most of. Worth waiting for, unlike the case above, and the message has to say which it is.
  it("distinguishes a full node from a demand no node could meet", async () => {
    const wants4Gi = record({
      id: "agent-2",
      spec: {
        image: "img",
        resources: { limits: { cpu: "1", memory: "4Gi" } },
      } as never,
    });
    const holding6Gi = record({
      assignedNode: "node-1",
      spec: {
        image: "img",
        resources: { limits: { cpu: "1", memory: "6Gi" } },
      } as never,
    });
    const { scheduler, statuses } = harness(
      [holding6Gi, wants4Gi],
      [{ id: "node-1", cpuMilli: 4000, memoryBytes: 8 * 1024 ** 3 }],
    );
    await scheduler.tick();
    expect(statuses).toEqual([
      [
        "agent-2",
        {
          noCapacityMessage:
            "No node has 4.0 Gi of memory free. This agent starts as soon as room frees up.",
          overBudget: false,
          overBudgetMessage: "",
        },
      ],
    ]);
  });

  it("stops saying it once the agent is placed", async () => {
    const { scheduler, statuses, assigns } = harness(
      [record({ status: { noCapacityMessage: "no room" } })],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(assigns).toEqual([["agent-1", "node-1"]]);
    expect(statuses).toEqual([
      [
        "agent-1",
        { noCapacityMessage: "", overBudget: false, overBudgetMessage: "" },
      ],
    ]);
  });

  // TEST_SCENARIO: an owner whose running agents already fill their ceiling, asking for one more. Nothing else in the install can answer this: two API requests that each fit would both pass, and a node's supervisor only knows its own machine, while the ceiling is install-wide.
  it("refuses to place an agent past its owner's ceiling", async () => {
    const oneCore = {
      image: "img",
      resources: { limits: { cpu: "1", memory: "2Gi" } },
    } as never;
    const { scheduler, assigns, statuses } = harness(
      [
        record({ id: "held-1", spec: oneCore, assignedNode: "node-1" }),
        record({ id: "held-2", spec: oneCore, assignedNode: "node-1" }),
        record({ id: "asking", spec: oneCore }),
      ],
      [{ id: "node-1", cpuMilli: 64_000, memoryBytes: 128 * 1024 ** 3 }],
      { cpu: "2", memory: "64Gi" },
    );
    await scheduler.tick();
    expect(assigns).toEqual([]);
    expect(statuses).toEqual([
      [
        "asking",
        {
          overBudget: true,
          overBudgetMessage:
            "Starting this agent would take you to 3 of 2 CPU. Stop or pause another agent to free room.",
          noCapacityMessage: "",
        },
      ],
    ]);
  });

  // TEST_SCENARIO: the same owner with room to spare. The ceiling has to be a limit rather than a discouragement, so the ordinary case must not be touched by it.
  it("places an agent that fits inside the ceiling", async () => {
    const { scheduler, assigns } = harness(
      [record({})],
      [{ id: "node-1", cpuMilli: 64_000, memoryBytes: 128 * 1024 ** 3 }],
      { cpu: "4", memory: "8Gi" },
    );
    await scheduler.tick();
    expect(assigns).toEqual([["agent-1", "node-1"]]);
  });

  // TEST_SCENARIO: a ceiling whose memory is the binding half. A message naming CPU when memory ran out leaves a person acting on the wrong number.
  it("names the dimension that ran out", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          spec: {
            image: "img",
            resources: { limits: { cpu: "1", memory: "16Gi" } },
          } as never,
        }),
      ],
      [{ id: "node-1", cpuMilli: 64_000, memoryBytes: 128 * 1024 ** 3 }],
      { cpu: "64", memory: "8Gi" },
    );
    await scheduler.tick();
    expect(statuses[0]?.[1].overBudgetMessage).toMatch(
      /16.0 Gi of 8.0 Gi memory/,
    );
  });

  it("releases an agent that has gone idle on a node, leaving its teardown to that node", async () => {
    const { scheduler, assigns, statuses } = harness(
      [
        record({
          annotations: {
            [LAST_ACTIVITY]: new Date(Date.now() - 3600_000).toISOString(),
          },
          status: { ready: true },
          assignedNode: "node-1",
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(assigns).toEqual([["agent-1", null]]);
    expect(statuses).toEqual([]);
  });
});

// TEST_OVERVIEW: the lock deciding who schedules can be lost in the middle of a pass. The pass in flight then belongs to a node that no longer leads, and every assignment it still makes races the node that does — so losing the lock has to stop the pass between records, not merely cancel the next one.
describe("a pass interrupted by losing the lock", () => {
  it("stops assigning as soon as stop() is called", async () => {
    const records = ["a", "b", "c"].map((id) =>
      record({
        id,
        spec: {
          image: "img",
          resources: { limits: { cpu: "1", memory: "1Gi" } },
        } as never,
      }),
    );
    const assigns: string[] = [];
    let scheduler: ReturnType<typeof createScheduler>;
    scheduler = createScheduler({
      store: {
        list: async () => records,
        assign: async (id: string) => {
          assigns.push(id);
          scheduler.stop();
          return null;
        },
        writeStatus: async () => null,
      } as never,
      registry: { ready: async () => [SMALL_NODE] } as never,
      defaultIdleTimeoutMs: 60_000,
      ceilingFor: async () => ({ cpu: "64", memory: "128Gi" }),
      log: () => {},
    });
    await scheduler.tick();
    expect(assigns).toEqual(["a"]);
  });
});

// TEST_OVERVIEW: an agent that will not start has exactly one reason at a time, and the reader ranks a budget complaint above a capacity one. Each branch used to write only its own field, so an agent that changed reasons carried both and was described by whichever ranked higher rather than by whichever was true. The owner is then told to stop another of their agents after they already have, while the thing actually in the way is the install being full.
describe("changing why an agent cannot be placed", () => {
  const idle = new Date(Date.now() - 3600_000).toISOString();

  // TEST_SCENARIO: over budget, then the owner frees room — but the install is full, so the answer is now "wait", not "stop one of yours".
  it("clears the budget complaint when capacity becomes the reason", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          spec: { image: "img", resources: { limits: BIG } } as never,
          status: { overBudget: true, overBudgetMessage: "over" },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    const [, patch] = statuses.at(-1)!;
    expect(patch.overBudget).toBe(false);
    expect(patch.overBudgetMessage).toBe("");
    expect(patch.noCapacityMessage).toMatch(/largest node/);
  });

  // TEST_SCENARIO: the other direction — the install frees up while the owner is still over their ceiling.
  it("clears the capacity complaint when the budget becomes the reason", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          status: { noCapacityMessage: "no room anywhere" },
        }),
      ],
      [SMALL_NODE],
      { cpu: "0.5", memory: "512Mi" },
    );
    await scheduler.tick();
    const [, patch] = statuses.at(-1)!;
    expect(patch.overBudget).toBe(true);
    expect(patch.noCapacityMessage).toBe("");
  });

  // TEST_SCENARIO: the numbers in a budget message move as the owner's other agents come and go. The message is what the person reads, so a stale one is as wrong as a stale flag — and only the flag used to be checked.
  it("rewrites a budget message whose figures have changed", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          status: { overBudget: true, overBudgetMessage: "an older figure" },
        }),
      ],
      [SMALL_NODE],
      { cpu: "0.5", memory: "512Mi" },
    );
    await scheduler.tick();
    expect(statuses.at(-1)![1].overBudgetMessage).toMatch(/would take you to/);
  });

  // TEST_SCENARIO: nothing changed. A scheduler that rewrites an unchanged complaint every thirty seconds fans an invalidation hint out to every watching browser for no reason.
  it("says nothing when the reason has not moved", async () => {
    const { scheduler, statuses } = harness(
      [
        record({
          annotations: { [LAST_ACTIVITY]: idle },
          status: { hibernated: true },
        }),
      ],
      [SMALL_NODE],
    );
    await scheduler.tick();
    expect(statuses).toEqual([]);
  });
});
