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
