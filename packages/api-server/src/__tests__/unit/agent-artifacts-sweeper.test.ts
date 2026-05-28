import { describe, it, expect, vi } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createAgentArtifactsSweeper } from "../../sagas/agent-artifacts-sweeper.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeK8s(liveAgents: string[]): K8sClient {
  return {
    listConfigMaps: async () =>
      liveAgents.map((name) => ({ metadata: { name } }) as k8s.V1ConfigMap),
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
      intervalMs: 30_000,
      batchSize: 100,
    });

    await sweeper.tick();

    // Live agents are NEVER touched.
    expect(cleaned.find((c) => c.id === "agent-live-1")).toBeUndefined();
    expect(cleaned.find((c) => c.id === "agent-live-2")).toBeUndefined();

    // Both orphans get cleanup called on EVERY source — A appears in both
    // tables, B only in egress, but we still call approvals.cleanup(B) so a
    // stray pending row that arrived between the listAgentIds calls also
    // gets reaped.
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
      intervalMs: 30_000,
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
      intervalMs: 30_000,
      batchSize: 100,
    });

    await sweeper.tick();
    expect(cleaned).toEqual(["agent-orphan"]);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
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
      intervalMs: 30_000,
      batchSize: 100,
    });

    await sweeper.tick();
    expect(cleaned).toEqual([]);
  });
});
