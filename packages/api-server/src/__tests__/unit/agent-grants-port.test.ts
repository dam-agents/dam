import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createAgentGrantsPort } from "../../modules/agents/infrastructure/agent-grants-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  ANN_SECRETS_REV,
  LABEL_AGENT_REF,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_INSTANCE,
} from "../../modules/agents/infrastructure/labels.js";

function instanceCM(name: string, annotations: Record<string, string> = {}, agentRef = "agent-1"): k8s.V1ConfigMap {
  return {
    metadata: {
      name,
      labels: {
        [LABEL_TYPE]: TYPE_INSTANCE,
        [LABEL_OWNER]: "owner-1",
        [LABEL_AGENT_REF]: agentRef,
      },
      annotations,
    },
  };
}

function fakeClient(initial: k8s.V1ConfigMap[]) {
  const store = new Map(initial.map((cm) => [cm.metadata!.name!, cm]));
  const patches: { name: string; body: object }[] = [];
  const client: K8sClient = {
    namespace: "platform-agents",
    listConfigMaps: async (selector) => {
      // The port queries by labels; assume any configured fake matches.
      const items = Array.from(store.values());
      // Honor a agent-platform.ai/agent= filter when present so multi-agent fixtures
      // don't bleed across tests.
      const m = /platform\.ai\/agent=([^,]+)/.exec(selector);
      if (!m) return items;
      return items.filter((cm) => cm.metadata?.labels?.[LABEL_AGENT_REF] === m[1]);
    },
    getConfigMap: async (n) => store.get(n) ?? null,
    createConfigMap: async (b) => b,
    replaceConfigMap: async (_n, b) => b,
    patchConfigMap: async (n, body) => {
      patches.push({ name: n, body });
      const existing = store.get(n);
      if (!existing) return;
      const patchAnn =
        ((body as { metadata?: { annotations?: Record<string, string | null> } })
          .metadata?.annotations) ?? {};
      const next = { ...(existing.metadata?.annotations ?? {}) };
      for (const [k, v] of Object.entries(patchAnn)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      store.set(n, {
        ...existing,
        metadata: { ...existing.metadata, annotations: next },
      });
    },
    deleteConfigMap: async () => undefined,
    listSecrets: async () => [],
    getSecret: async () => null,
    createSecret: async (b) => b,
    replaceSecret: async (_n, b) => b,
    deleteSecret: async () => undefined,
    listPods: async () => [],
    getPod: async () => null,
    patchPod: async () => undefined,
    deletePod: async () => false,
    listPVCs: async () => [],
    deletePVC: async () => undefined,
  };
  return { client, store, patches };
}

describe("createAgentGrantsPort.get", () => {
  it("returns empty grants when no instance exists", async () => {
    const { client } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants).toEqual({
      grantedSecretIds: [],
      grantedConnectionIds: [],
    });
  });

  it("reads selective secret grants from the instance CM", async () => {
    const { client } = fakeClient([
      instanceCM("inst-1", {
        [ANN_GRANTED_SECRET_IDS]: "aaa,bbb",
      }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants.grantedSecretIds).toEqual(["aaa", "bbb"]);
    expect(grants.grantedConnectionIds).toEqual([]);
  });

  it("absent connection annotation reads as empty (always-selective)", async () => {
    {
      const { client } = fakeClient([instanceCM("inst-1", {})]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual([]);
    }
    {
      const { client } = fakeClient([
        instanceCM("inst-1", { [ANN_GRANTED_CONNECTION_IDS]: "" }),
      ]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual([]);
    }
    {
      const { client } = fakeClient([
        instanceCM("inst-1", { [ANN_GRANTED_CONNECTION_IDS]: "github,slack" }),
      ]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual(["github", "slack"]);
    }
  });
});

describe("createAgentGrantsPort.setSecretGrants", () => {
  it("writes the literal (possibly empty) list", async () => {
    const { client, patches } = fakeClient([instanceCM("inst-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setSecretGrants("agent-1", []);
    expect(patches.at(-1)!.body).toEqual({
      metadata: { annotations: { [ANN_GRANTED_SECRET_IDS]: "" } },
    });

    await port.setSecretGrants("agent-1", ["aaa", "bbb"]);
    expect(patches.at(-1)!.body).toEqual({
      metadata: { annotations: { [ANN_GRANTED_SECRET_IDS]: "aaa,bbb" } },
    });
  });

  it("fans out the patch to every instance of the agent", async () => {
    const { client, patches } = fakeClient([
      instanceCM("inst-1"),
      instanceCM("inst-2"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.setSecretGrants("agent-1", ["aaa"]);
    expect(patches.map((p) => p.name).sort()).toEqual(["inst-1", "inst-2"]);
  });
});

describe("createAgentGrantsPort.setConnectionGrants", () => {
  it("writes the literal (possibly empty) list", async () => {
    const { client, patches } = fakeClient([instanceCM("inst-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setConnectionGrants("agent-1", []);
    expect(patches.at(-1)!.body).toEqual({
      metadata: { annotations: { [ANN_GRANTED_CONNECTION_IDS]: "" } },
    });

    await port.setConnectionGrants("agent-1", ["github", "slack"]);
    expect(patches.at(-1)!.body).toEqual({
      metadata: { annotations: { [ANN_GRANTED_CONNECTION_IDS]: "github,slack" } },
    });
  });
});

describe("createAgentGrantsPort.listAgentsGrantedSecret", () => {
  it("returns each unique agent (with all instance CM names) that has the secret granted", async () => {
    const { client } = fakeClient([
      instanceCM("a1-inst-1", { [ANN_GRANTED_SECRET_IDS]: "secret-x,secret-y" }, "agent-a"),
      instanceCM("a1-inst-2", { [ANN_GRANTED_SECRET_IDS]: "secret-x,secret-y" }, "agent-a"),
      instanceCM("b1-inst", { [ANN_GRANTED_SECRET_IDS]: "secret-y" }, "agent-b"),
      instanceCM("c1-inst", { [ANN_GRANTED_SECRET_IDS]: "secret-z" }, "agent-c"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const result = await port.listAgentsGrantedSecret("secret-x");
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("agent-a");
    expect(result[0]!.instanceCmNames.sort()).toEqual(["a1-inst-1", "a1-inst-2"]);
    expect(result[0]!.grantedSecretIds.sort()).toEqual(["secret-x", "secret-y"]);
  });

  it("returns empty array when the secret is not granted to any agent", async () => {
    const { client } = fakeClient([
      instanceCM("a1-inst", { [ANN_GRANTED_SECRET_IDS]: "secret-y" }, "agent-a"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });

  it("ignores instance CMs with absent or empty granted-secret-ids", async () => {
    const { client } = fakeClient([
      instanceCM("a1-inst", {}, "agent-a"),
      instanceCM("b1-inst", { [ANN_GRANTED_SECRET_IDS]: "" }, "agent-b"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });
});

describe("createAgentGrantsPort.bumpSecretsRev", () => {
  it("patches the secrets-rev annotation on the named instance CM", async () => {
    const { client, patches } = fakeClient([instanceCM("inst-1")]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.bumpSecretsRev("inst-1", "abc123def456");
    expect(patches.at(-1)).toEqual({
      name: "inst-1",
      body: { metadata: { annotations: { [ANN_SECRETS_REV]: "abc123def456" } } },
    });
  });
});
