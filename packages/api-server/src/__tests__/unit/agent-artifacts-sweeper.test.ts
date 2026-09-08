import { describe, it, expect, vi } from "vitest";
import { createAgentArtifactsSweeper } from "../../sagas/agent-artifacts-sweeper.js";
import { events$, ofType, EventType, type AgentDeleted } from "../../events.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";

function fakeK8s(
  liveAgents: string[],
  opts: { appearsAfterList?: string[] } = {},
): K8sClient {
  const present = new Set([...liveAgents, ...(opts.appearsAfterList ?? [])]);
  return {
    listCustomObjects: async () =>
      liveAgents.map((name) => ({ metadata: { name } }) as KubeObject),
    getCustomObject: async (_plural: string, name: string) =>
      present.has(name) ? ({ metadata: { name } } as KubeObject) : null,
  } as unknown as K8sClient;
}

describe("agent-artifacts-sweeper", () => {
  it("deletes only orphans (agent_ids present in DB but missing in K8s)", async () => {
    const cleaned: Array<{ source: string; id: string }> = [];

    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s(["agent-live-1", "agent-live-2"]),
      sources: [
        {
          name: "egress",
          listAgentIds: async () => [
            "agent-live-1",
            "agent-orphan-A",
            "agent-orphan-B",
          ],
          cleanup: async (id) => {
            cleaned.push({ source: "egress", id });
          },
        },
        {
          name: "approvals",
          listAgentIds: async () => ["agent-live-2", "agent-orphan-A"],
          cleanup: async (id) => {
            cleaned.push({ source: "approvals", id });
          },
        },
      ],
      resolveOwner: async () => null,
      batchSize: 100,
    });

    await sweeper.tick();

    expect(cleaned.find((c) => c.id === "agent-live-1")).toBeUndefined();
    expect(cleaned.find((c) => c.id === "agent-live-2")).toBeUndefined();

    const orphanIds = cleaned.map((c) => c.id);
    expect(orphanIds.filter((id) => id === "agent-orphan-A")).toHaveLength(2);
    expect(orphanIds.filter((id) => id === "agent-orphan-B")).toHaveLength(2);
  });

  it("respects batchSize per tick", async () => {
    const cleaned: string[] = [];
    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s([]),
      sources: [
        {
          name: "egress",
          listAgentIds: async () => ["a", "b", "c", "d", "e"],
          cleanup: async (id) => {
            cleaned.push(id);
          },
        },
      ],
      resolveOwner: async () => null,
      batchSize: 2,
    });

    await sweeper.tick();
    expect(cleaned).toHaveLength(2);
  });

  it("continues to the next source if one source's cleanup throws", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const cleaned: string[] = [];

    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s([]),
      sources: [
        {
          name: "egress",
          listAgentIds: async () => ["agent-orphan"],
          cleanup: async () => {
            throw new Error("boom");
          },
        },
        {
          name: "approvals",
          listAgentIds: async () => ["agent-orphan"],
          cleanup: async (id) => {
            cleaned.push(id);
          },
        },
      ],
      resolveOwner: async () => null,
      batchSize: 100,
    });

    await sweeper.tick();
    expect(cleaned).toEqual(["agent-orphan"]);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  /**
   * TEST_SCENARIO: An Agent created between the CR list and the source scan
   * shows up as an orphan candidate. Its rows must survive: the sweep re-reads
   * the CR before touching anything, because some cleanups soft-delete the
   * agent's usage record.
   */
  it("skips a candidate whose Agent exists by the time it is reaped", async () => {
    const cleaned: string[] = [];
    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s([], { appearsAfterList: ["agent-new"] }),
      sources: [
        {
          name: "usage-agents",
          listAgentIds: async () => ["agent-new", "agent-orphan"],
          cleanup: async (id) => {
            cleaned.push(id);
          },
        },
      ],
      resolveOwner: async () => null,
      batchSize: 100,
    });

    await sweeper.tick();
    expect(cleaned).toEqual(["agent-orphan"]);
  });

  /**
   * TEST_SCENARIO: Every cleanup runs from the one source list. Afterwards each
   * confirmed orphan is announced once as an AgentDeleted event carrying the
   * owner the sweep could still resolve, so projections and runtime reactions
   * (UI hint, Slack worker) see it as on an API delete. A candidate whose Agent
   * still exists is never cleaned or announced.
   */
  it("announces each confirmed orphan once, with its owner, after every cleanup", async () => {
    const order: string[] = [];
    const sub = events$()
      .pipe(ofType<AgentDeleted>(EventType.AgentDeleted))
      .subscribe((e) => {
        order.push(`deleted:${e.agentId}:${e.ownerSub ?? "?"}`);
      });
    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s(["agent-live"], { appearsAfterList: ["agent-new"] }),
      sources: [
        {
          name: "egress",
          listAgentIds: async () => ["agent-orphan"],
          cleanup: async (id) => {
            order.push(`egress:${id}`);
          },
        },
        {
          name: "channels",
          listAgentIds: async () => ["agent-orphan", "agent-new", "agent-live"],
          cleanup: async (id) => {
            order.push(`channels:${id}`);
          },
        },
      ],
      resolveOwner: async (id) => (id === "agent-orphan" ? "owner-1" : null),
      batchSize: 100,
    });

    await sweeper.tick();
    sub.unsubscribe();
    expect(order).toEqual([
      "egress:agent-orphan",
      "channels:agent-orphan",
      "deleted:agent-orphan:owner-1",
    ]);
  });

  it("is a no-op when there are no orphans", async () => {
    const cleaned: string[] = [];
    const sweeper = createAgentArtifactsSweeper({
      k8s: fakeK8s(["agent-1"]),
      sources: [
        {
          name: "egress",
          listAgentIds: async () => ["agent-1"],
          cleanup: async (id) => {
            cleaned.push(id);
          },
        },
      ],
      resolveOwner: async () => null,
      batchSize: 100,
    });

    await sweeper.tick();
    expect(cleaned).toEqual([]);
  });
});
