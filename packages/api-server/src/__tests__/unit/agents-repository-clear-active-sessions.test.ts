import { describe, it, expect } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import {
  ACTIVE_SESSION_KEY,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

function agentObj(
  name: string,
  annotations: Record<string, string> = {},
): KubeObject {
  return {
    apiVersion: "agent-platform.ai/v1",
    kind: "Agent",
    metadata: { name, labels: { [LABEL_OWNER]: "owner-1" }, annotations },
    spec: {},
  };
}

function fakeClient(initial: KubeObject[]) {
  const store = new Map(initial.map((o) => [o.metadata!.name!, o]));
  const patches: { name: string; body: object }[] = [];
  const unsupported = () => {
    throw new Error("not used in these tests");
  };
  const client: K8sClient = {
    namespace: "platform-agents",

    listSecrets: async () => [],
    getSecret: async () => null,
    createSecret: unsupported,
    replaceSecret: unsupported,
    deleteSecret: async () => undefined,

    getCustomObject: async (_plural, name) => store.get(name) ?? null,
    listCustomObjects: async () => Array.from(store.values()),
    createCustomObject: async (_plural, body) => body as KubeObject,
    patchCustomObject: async (_plural, name, body) => {
      patches.push({ name, body });
      return store.get(name) ?? ({} as KubeObject);
    },
    deleteCustomObject: async () => undefined,
  };
  return { client, patches };
}

describe("AgentsRepository.clearActiveSessions", () => {
  it("clears active-session only on pinned agents and returns the count", async () => {
    const { client, patches } = fakeClient([
      agentObj("agent-pinned", { [ACTIVE_SESSION_KEY]: "true" }),
      agentObj("agent-idle"),
      agentObj("agent-already-clear", { [ACTIVE_SESSION_KEY]: "" }),
    ]);
    const repo = createAgentsRepository(client);

    const cleared = await repo.clearActiveSessions();

    expect(cleared).toBe(1);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.name).toBe("agent-pinned");
    expect(patches[0]!.body).toEqual({
      metadata: { annotations: { [ACTIVE_SESSION_KEY]: "" } },
    });
  });

  it("returns 0 and patches nothing when no agent is pinned", async () => {
    const { client, patches } = fakeClient([agentObj("a"), agentObj("b")]);
    const repo = createAgentsRepository(client);

    expect(await repo.clearActiveSessions()).toBe(0);
    expect(patches).toHaveLength(0);
  });
});
