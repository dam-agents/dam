import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createAgentGrantsPort } from "../../modules/agents/infrastructure/agent-grants-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  ANN_SECRETS_REV,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_AGENT,
} from "../../modules/agents/infrastructure/labels.js";

/** Per ADR-046, an agent is a single ConfigMap and grants live as
 *  annotations on it directly — no back-pointer label, no fan-out across
 *  multiple instances. */
function agentCM(
  name: string,
  annotations: Record<string, string> = {},
  owner = "owner-1",
): k8s.V1ConfigMap {
  return {
    metadata: {
      name,
      labels: {
        [LABEL_TYPE]: TYPE_AGENT,
        [LABEL_OWNER]: owner,
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
    listConfigMaps: async () => Array.from(store.values()),
    getConfigMap: async (n) => store.get(n) ?? null,
    createConfigMap: async (b) => b,
    replaceConfigMap: async (_n, b) => b,
    patchConfigMap: async (n, body) => {
      patches.push({ name: n, body });
      const existing = store.get(n);
      if (!existing) return;
      const patchAnn =
        (body as { metadata?: { annotations?: Record<string, string | null> } })
          .metadata?.annotations ?? {};
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
  it("returns empty grants when the agent does not exist", async () => {
    const { client } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants).toEqual({
      grantedSecretIds: [],
      grantedConnectionIds: [],
    });
  });

  it("returns empty grants when the agent is owned by someone else", async () => {
    const { client } = fakeClient([
      agentCM(
        "agent-1",
        { [ANN_GRANTED_SECRET_IDS]: "aaa,bbb" },
        "owner-other",
      ),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants).toEqual({
      grantedSecretIds: [],
      grantedConnectionIds: [],
    });
  });

  it("reads selective secret grants from the agent CM", async () => {
    const { client } = fakeClient([
      agentCM("agent-1", { [ANN_GRANTED_SECRET_IDS]: "aaa,bbb" }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants.grantedSecretIds).toEqual(["aaa", "bbb"]);
    expect(grants.grantedConnectionIds).toEqual([]);
  });

  it("absent connection annotation reads as empty (always-selective)", async () => {
    {
      const { client } = fakeClient([agentCM("agent-1", {})]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual([]);
    }
    {
      const { client } = fakeClient([
        agentCM("agent-1", { [ANN_GRANTED_CONNECTION_IDS]: "" }),
      ]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual([]);
    }
    {
      const { client } = fakeClient([
        agentCM("agent-1", { [ANN_GRANTED_CONNECTION_IDS]: "github,slack" }),
      ]);
      const port = createAgentGrantsPort(client, "owner-1");
      const grants = await port.get("agent-1");
      expect(grants.grantedConnectionIds).toEqual(["github", "slack"]);
    }
  });
});

describe("createAgentGrantsPort.setSecretGrants", () => {
  it("writes the literal (possibly empty) list to the agent CM", async () => {
    const { client, patches } = fakeClient([agentCM("agent-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setSecretGrants("agent-1", []);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: { metadata: { annotations: { [ANN_GRANTED_SECRET_IDS]: "" } } },
    });

    await port.setSecretGrants("agent-1", ["aaa", "bbb"]);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: {
        metadata: { annotations: { [ANN_GRANTED_SECRET_IDS]: "aaa,bbb" } },
      },
    });
  });

  it("throws when the agent does not exist", async () => {
    const { client, patches } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    await expect(port.setSecretGrants("agent-1", ["aaa"])).rejects.toThrow(
      /not found or not owned/,
    );
    expect(patches).toEqual([]);
  });

  it("throws when the agent is owned by someone else", async () => {
    const { client, patches } = fakeClient([
      agentCM("agent-1", {}, "owner-other"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    await expect(port.setSecretGrants("agent-1", ["aaa"])).rejects.toThrow(
      /not found or not owned/,
    );
    expect(patches).toEqual([]);
  });
});

describe("createAgentGrantsPort.setConnectionGrants", () => {
  it("writes the literal (possibly empty) list to the agent CM", async () => {
    const { client, patches } = fakeClient([agentCM("agent-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setConnectionGrants("agent-1", []);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: {
        metadata: { annotations: { [ANN_GRANTED_CONNECTION_IDS]: "" } },
      },
    });

    await port.setConnectionGrants("agent-1", ["github", "slack"]);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: {
        metadata: {
          annotations: { [ANN_GRANTED_CONNECTION_IDS]: "github,slack" },
        },
      },
    });
  });

  it("throws when the agent does not exist", async () => {
    const { client, patches } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    await expect(
      port.setConnectionGrants("agent-1", ["github"]),
    ).rejects.toThrow(/not found or not owned/);
    expect(patches).toEqual([]);
  });
});

describe("createAgentGrantsPort.listAgentsGrantedSecret", () => {
  it("returns each agent that has the secret granted", async () => {
    const { client } = fakeClient([
      agentCM("agent-a", { [ANN_GRANTED_SECRET_IDS]: "secret-x,secret-y" }),
      agentCM("agent-b", { [ANN_GRANTED_SECRET_IDS]: "secret-y" }),
      agentCM("agent-c", { [ANN_GRANTED_SECRET_IDS]: "secret-z" }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const result = await port.listAgentsGrantedSecret("secret-x");
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("agent-a");
    expect(result[0]!.grantedSecretIds.sort()).toEqual([
      "secret-x",
      "secret-y",
    ]);
  });

  it("returns empty array when the secret is not granted to any agent", async () => {
    const { client } = fakeClient([
      agentCM("agent-a", { [ANN_GRANTED_SECRET_IDS]: "secret-y" }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });

  it("ignores agent CMs with absent or empty granted-secret-ids", async () => {
    const { client } = fakeClient([
      agentCM("agent-a", {}),
      agentCM("agent-b", { [ANN_GRANTED_SECRET_IDS]: "" }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });
});

describe("createAgentGrantsPort.bumpSecretsRev", () => {
  it("patches the secrets-rev annotation on the named agent CM", async () => {
    const { client, patches } = fakeClient([agentCM("agent-1")]);
    const port = createAgentGrantsPort(client, "owner-1");
    await port.bumpSecretsRev("agent-1", "abc123def456");
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: {
        metadata: { annotations: { [ANN_SECRETS_REV]: "abc123def456" } },
      },
    });
  });
});
