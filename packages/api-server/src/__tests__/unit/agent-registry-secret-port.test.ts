import { describe, it, expect } from "vitest";
import * as k8s from "@kubernetes/client-node";
import {
  buildDockerConfigJson,
  createAgentRegistrySecretPort,
} from "../../modules/agents/infrastructure/agent-registry-secret-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeClient(initial: k8s.V1Secret[] = []) {
  const created: k8s.V1Secret[] = [];
  const deleted: string[] = [];
  const store = new Map(initial.map((s) => [s.metadata!.name!, s]));
  const unsupported = () => {
    throw new Error("not used in these tests");
  };
  const client: K8sClient = {
    namespace: "platform-agents",
    listSecrets: async (selector) => {
      const pairs = selector.split(",").map((p) => p.split("="));
      return [...store.values()].filter((s) =>
        pairs.every(([k, v]) => s.metadata?.labels?.[k!] === v),
      );
    },
    getSecret: async (name) => store.get(name) ?? null,
    createSecret: async (body) => {
      created.push(body);
      store.set(body.metadata!.name!, body);
      return body;
    },
    replaceSecret: unsupported,
    deleteSecret: async (name) => {
      deleted.push(name);
      store.delete(name);
    },
    getCustomObject: async () => null,
    listCustomObjects: async () => [],
    createCustomObject: unsupported,
    patchCustomObject: unsupported,
    deleteCustomObject: async () => undefined,
  };
  return { client, created, deleted };
}

describe("buildDockerConfigJson", () => {
  it("base64-encodes user:password under the server's auths entry", () => {
    const json = buildDockerConfigJson({
      server: "registry.example.com",
      username: "robot",
      password: "s3cr3t",
    });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      auths: {
        "registry.example.com": {
          auth: Buffer.from("robot:s3cr3t").toString("base64"),
        },
      },
    });
  });
});

describe("createAgentRegistrySecretPort.create", () => {
  it("writes a dockerconfigjson Secret labelled owner+agent", async () => {
    const { client, created } = fakeClient();
    const port = createAgentRegistrySecretPort(client);

    await port.create("agent-abc123", "owner-1", {
      server: "ghcr.io",
      username: "u",
      password: "p",
    });

    expect(created).toHaveLength(1);
    const body = created[0]!;
    expect(body.metadata?.name).toBe("agent-abc123-registry-pull");
    expect(body.type).toBe("kubernetes.io/dockerconfigjson");
    expect(body.metadata?.labels).toEqual({
      "agent-platform.ai/owner": "owner-1",
      "agent-platform.ai/agent": "agent-abc123",
      "agent-platform.ai/secret-type": "registry-pull",
      "agent-platform.ai/managed-by": "api-server",
    });
    const dockerconfig = JSON.parse(body.stringData![".dockerconfigjson"]!);
    expect(dockerconfig.auths["ghcr.io"].auth).toBe(
      Buffer.from("u:p").toString("base64"),
    );
  });
});

describe("createAgentRegistrySecretPort.delete", () => {
  it("deletes the secret by its deterministic name", async () => {
    const { client, deleted } = fakeClient();
    const port = createAgentRegistrySecretPort(client);
    await port.delete("agent-abc123");
    expect(deleted).toEqual(["agent-abc123-registry-pull"]);
  });
});

describe("createAgentRegistrySecretPort.listAgentIds", () => {
  it("returns the agent label of every managed registry-pull secret", async () => {
    const { client } = fakeClient([
      {
        metadata: {
          name: "agent-a-registry-pull",
          labels: {
            "agent-platform.ai/agent": "agent-a",
            "agent-platform.ai/secret-type": "registry-pull",
            "agent-platform.ai/managed-by": "api-server",
          },
        },
      },
      {
        metadata: {
          name: "some-other-secret",
          labels: { "agent-platform.ai/secret-type": "github" },
        },
      },
      {
        metadata: {
          name: "agent-b-registry-pull",
          labels: {
            "agent-platform.ai/agent": "agent-b",
            "agent-platform.ai/secret-type": "registry-pull",
            "agent-platform.ai/managed-by": "api-server",
          },
        },
      },
    ]);
    const port = createAgentRegistrySecretPort(client);
    expect((await port.listAgentIds()).sort()).toEqual(["agent-a", "agent-b"]);
  });
});
