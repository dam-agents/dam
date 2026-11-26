// TEST_OVERVIEW: the claim a kit apply on an existing Agent takes is a compare-and-set on the Kit Version annotation: it lands only while the annotation still holds what the claim read, so of two applies on one Agent only one goes on, and a release clears only the claim it made.
import { describe, expect, it } from "vitest";

import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { createKitClaim } from "../../modules/agents/infrastructure/kit-stamp.js";
import { ANN_STARTER_KIT } from "../../modules/agents/infrastructure/labels.js";

const KIT = "platform/code-reviewer@abc123";

function agent(starterKit?: string): KubeObject {
  return {
    metadata: {
      name: "agent-1",
      labels: { "agent-platform.ai/owner": "owner-1" },
      resourceVersion: "41",
      annotations: starterKit ? { [ANN_STARTER_KIT]: starterKit } : {},
    },
    spec: { name: "agent-1" },
  } as KubeObject;
}

/** TEST_SCENARIO: the fixture — an API server that enforces `metadata.resourceVersion` on a patch, drops an annotation patched to null, and can run another writer's patch between a read and the next patch. */
function apiServer(initial: KubeObject) {
  let stored = initial;
  let beforePatch: ((current: KubeObject) => KubeObject) | null = null;
  const client = {
    namespace: "test-agents",
    watchCustomObjects: () => () => {},
    getCustomObject: async () => structuredClone(stored),
    listCustomObjects: async () => [structuredClone(stored)],
    async patchCustomObject(_plural: string, name: string, body: unknown) {
      if (beforePatch) {
        stored = beforePatch(stored);
        beforePatch = null;
      }
      const patch = body as KubeObject;
      const sent = patch.metadata?.resourceVersion;
      if (sent !== undefined && sent !== stored.metadata?.resourceVersion)
        throw Object.assign(new Error(`409: ${name}`), { code: 409 });
      const annotations: Record<string, string> = {
        ...stored.metadata?.annotations,
      };
      for (const [k, v] of Object.entries(patch.metadata?.annotations ?? {}))
        if (v === null) delete annotations[k];
        else annotations[k] = v;
      stored = {
        ...stored,
        metadata: {
          ...stored.metadata,
          annotations,
          resourceVersion: String(
            Number(stored.metadata?.resourceVersion ?? 0) + 1,
          ),
        },
      };
      return stored;
    },
  } as unknown as K8sClient;
  return {
    client,
    writeBySomeoneElse(write: (current: KubeObject) => KubeObject) {
      beforePatch = write;
    },
    kit: () => stored.metadata?.annotations?.[ANN_STARTER_KIT],
  };
}

function harness(initial: KubeObject) {
  const server = apiServer(initial);
  const repo = createAgentsRepository(
    server.client,
    createLiveAgentStateCache(server.client),
  );
  return { claim: createKitClaim(repo), server };
}

describe("kit claim", () => {
  it("claims an agent with no kit", async () => {
    const h = harness(agent());
    expect(await h.claim.claim("agent-1", KIT)).toBe(true);
    expect(h.server.kit()).toBe(KIT);
  });

  it("refuses an agent that already has a kit", async () => {
    const h = harness(agent("platform/other@1"));
    expect(await h.claim.claim("agent-1", KIT)).toBe(false);
    expect(h.server.kit()).toBe("platform/other@1");
  });

  // TEST_SCENARIO: another apply claims the Agent between this claim's read and its write. Its write moves the version this claim read, so this claim conflicts and the other kit stays.
  it("loses to a claim that lands between its read and its write", async () => {
    const h = harness(agent());
    h.server.writeBySomeoneElse((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        annotations: { [ANN_STARTER_KIT]: "platform/other@1" },
        resourceVersion: "42",
      },
    }));
    expect(await h.claim.claim("agent-1", KIT)).toBe(false);
    expect(h.server.kit()).toBe("platform/other@1");
  });

  it("releases only the claim it made", async () => {
    const own = harness(agent(KIT));
    await own.claim.release("agent-1", KIT);
    expect(own.server.kit()).toBeUndefined();

    const other = harness(agent("platform/other@1"));
    await other.claim.release("agent-1", KIT);
    expect(other.server.kit()).toBe("platform/other@1");
  });
});
