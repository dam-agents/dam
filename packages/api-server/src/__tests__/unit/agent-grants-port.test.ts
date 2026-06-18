import { describe, it, expect } from "vitest";
import { createAgentGrantsPort } from "../../modules/agents/infrastructure/agent-grants-port.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";

/** An agent is a single custom resource; grants live in its spec
 *  (`grantedSecretIds` / `grantedConnectionIds`). */
function agentObj(
  name: string,
  spec: Record<string, unknown> = {},
  owner = "owner-1",
): KubeObject {
  return {
    apiVersion: "agent-platform.ai/v1",
    kind: "Agent",
    metadata: { name, labels: { [LABEL_OWNER]: owner } },
    spec,
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
  return { client, store, patches };
}

describe("createAgentGrantsPort.get", () => {
  it("returns empty grants when the agent does not exist", async () => {
    const { client } = fakeClient([]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.get("agent-1")).toEqual({
      grantedSecretIds: [],
      grantedConnectionIds: [],
    });
  });

  it("returns empty grants when the agent is owned by someone else", async () => {
    const { client } = fakeClient([
      agentObj("agent-1", { grantedSecretIds: ["aaa", "bbb"] }, "owner-other"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.get("agent-1")).toEqual({
      grantedSecretIds: [],
      grantedConnectionIds: [],
    });
  });

  it("reads selective secret grants from the agent spec", async () => {
    const { client } = fakeClient([
      agentObj("agent-1", { grantedSecretIds: ["aaa", "bbb"] }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    const grants = await port.get("agent-1");
    expect(grants.grantedSecretIds).toEqual(["aaa", "bbb"]);
    expect(grants.grantedConnectionIds).toEqual([]);
  });

  it("absent connection grants read as empty (always-selective)", async () => {
    {
      const { client } = fakeClient([agentObj("agent-1", {})]);
      const port = createAgentGrantsPort(client, "owner-1");
      expect((await port.get("agent-1")).grantedConnectionIds).toEqual([]);
    }
    {
      const { client } = fakeClient([
        agentObj("agent-1", { grantedConnectionIds: ["github", "slack"] }),
      ]);
      const port = createAgentGrantsPort(client, "owner-1");
      expect((await port.get("agent-1")).grantedConnectionIds).toEqual([
        "github",
        "slack",
      ]);
    }
  });
});

describe("createAgentGrantsPort.setSecretGrants", () => {
  it("writes the literal (possibly empty) list to the agent spec", async () => {
    const { client, patches } = fakeClient([agentObj("agent-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setSecretGrants("agent-1", []);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: { spec: { grantedSecretIds: [] } },
    });

    await port.setSecretGrants("agent-1", ["aaa", "bbb"]);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: { spec: { grantedSecretIds: ["aaa", "bbb"] } },
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
      agentObj("agent-1", {}, "owner-other"),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    await expect(port.setSecretGrants("agent-1", ["aaa"])).rejects.toThrow(
      /not found or not owned/,
    );
    expect(patches).toEqual([]);
  });
});

describe("createAgentGrantsPort.setConnectionGrants", () => {
  it("writes the literal (possibly empty) list to the agent spec", async () => {
    const { client, patches } = fakeClient([agentObj("agent-1")]);
    const port = createAgentGrantsPort(client, "owner-1");

    await port.setConnectionGrants("agent-1", []);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: { spec: { grantedConnectionIds: [] } },
    });

    await port.setConnectionGrants("agent-1", ["github", "slack"]);
    expect(patches.at(-1)).toEqual({
      name: "agent-1",
      body: { spec: { grantedConnectionIds: ["github", "slack"] } },
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
      agentObj("agent-a", { grantedSecretIds: ["secret-x", "secret-y"] }),
      agentObj("agent-b", { grantedSecretIds: ["secret-y"] }),
      agentObj("agent-c", { grantedSecretIds: ["secret-z"] }),
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
      agentObj("agent-a", { grantedSecretIds: ["secret-y"] }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });

  it("ignores agents with absent or empty granted secrets", async () => {
    const { client } = fakeClient([
      agentObj("agent-a", {}),
      agentObj("agent-b", { grantedSecretIds: [] }),
    ]);
    const port = createAgentGrantsPort(client, "owner-1");
    expect(await port.listAgentsGrantedSecret("secret-x")).toEqual([]);
  });
});
