import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createAgentGrantsPort } from "../../modules/agents/infrastructure/agent-grants-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  ANN_SECRET_MODE,
  LABEL_AGENT_REF,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_INSTANCE,
} from "../../modules/agents/infrastructure/labels.js";

function instanceCM(name: string, annotations: Record<string, string> = {}): k8s.V1ConfigMap {
  return {
    metadata: {
      name,
      labels: {
        [LABEL_TYPE]: TYPE_INSTANCE,
        [LABEL_OWNER]: "owner-1",
        [LABEL_AGENT_REF]: "agent-1",
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
  it("returns the legacy default when no instance exists", async () => {
    const { client } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants).toEqual({
      secretMode: "all",
      grantedSecretIds: [],
      grantedConnectionIds: null,
    });
  });

  it("reads selective secret grants from the instance CM", async () => {
    const { client } = fakeClient([
      instanceCM("inst-1", {
        [ANN_SECRET_MODE]: "selective",
        [ANN_GRANTED_SECRET_IDS]: "aaa,bbb",
      }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants.secretMode).toBe("selective");
    expect(grants.grantedSecretIds).toEqual(["aaa", "bbb"]);
    expect(grants.grantedConnectionIds).toBeNull();
  });

  it("treats absent connection annotation as `all granted`, present-but-empty as none", async () => {
    {
      const { client } = fakeClient([instanceCM("inst-1", {})]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toBeNull();
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
  it("clears both annotations on `all` so absence is the canonical default", async () => {
    const { client, patches } = fakeClient([
      instanceCM("inst-1", {
        [ANN_SECRET_MODE]: "selective",
        [ANN_GRANTED_SECRET_IDS]: "aaa",
      }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.setSecretGrants("agent-1", "all", []);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      name: "inst-1",
      body: {
        metadata: {
          annotations: {
            [ANN_SECRET_MODE]: null,
            [ANN_GRANTED_SECRET_IDS]: null,
          },
        },
      },
    });
  });

  it("writes mode + comma-joined ids on selective", async () => {
    const { client, patches } = fakeClient([instanceCM("inst-1")]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.setSecretGrants("agent-1", "selective", ["aaa", "bbb"]);
    expect(patches[0].body).toEqual({
      metadata: {
        annotations: {
          [ANN_SECRET_MODE]: "selective",
          [ANN_GRANTED_SECRET_IDS]: "aaa,bbb",
        },
      },
    });
  });

  it("fans out the patch to every instance of the agent", async () => {
    const { client, patches } = fakeClient([
      instanceCM("inst-1"),
      instanceCM("inst-2"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.setSecretGrants("agent-1", "selective", ["aaa"]);
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
