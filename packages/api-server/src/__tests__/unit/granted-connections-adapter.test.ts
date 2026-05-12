import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createGrantedConnectionsAdapter } from "../../modules/pod-files/adapters/granted-connections.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

const LABEL_TYPE = "agent-platform.ai/type";
const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_AGENT_REF = "agent-platform.ai/agent";
const LABEL_CONNECTION = "agent-platform.ai/connection";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
const ANN_GRANTED_CONNECTION_IDS = "agent-platform.ai/granted-connection-ids";
const ANN_HOST_PATTERN = "agent-platform.ai/host-pattern";
const ANN_DISPLAY_NAME = "agent-platform.ai/display-name";
const ANN_HEADER_NAME = "agent-platform.ai/injection-header-name";
const ANN_VALUE_FORMAT = "agent-platform.ai/injection-value-format";
const ANN_TOKEN_URL = "agent-platform.ai/token-url";
const ANN_GRANT_TYPE = "agent-platform.ai/grant-type";
const ANN_CONNECTION_STATUS = "agent-platform.ai/connection-status";

function instanceCM(
  owner: string,
  agentId: string,
  grantedConnectionIds: string,
): k8s.V1ConfigMap {
  return {
    metadata: {
      name: "inst-1",
      labels: {
        [LABEL_TYPE]: "instance",
        [LABEL_OWNER]: owner,
        [LABEL_AGENT_REF]: agentId,
      },
      annotations: grantedConnectionIds
        ? { [ANN_GRANTED_CONNECTION_IDS]: grantedConnectionIds }
        : {},
    },
  };
}

function connectionSecret(
  owner: string,
  connection: string,
  hostPattern: string,
  displayName?: string,
): k8s.V1Secret {
  const labels: Record<string, string> = {
    [LABEL_OWNER]: owner,
    [LABEL_MANAGED_BY]: "api-server",
    [LABEL_SECRET_TYPE]: "connection",
    [LABEL_CONNECTION]: connection,
  };
  const annotations: Record<string, string> = {
    [ANN_HOST_PATTERN]: hostPattern,
    [ANN_HEADER_NAME]: "Authorization",
    [ANN_VALUE_FORMAT]: "Bearer {value}",
    [ANN_TOKEN_URL]: `https://${hostPattern}/login/oauth/access_token`,
    [ANN_GRANT_TYPE]: "authorization_code",
    [ANN_CONNECTION_STATUS]: "active",
  };
  if (displayName) annotations[ANN_DISPLAY_NAME] = displayName;
  return {
    metadata: { name: `platform-conn-${connection}`, labels, annotations },
  };
}

function fakeClient(cms: k8s.V1ConfigMap[], secrets: k8s.V1Secret[]): K8sClient {
  return {
    namespace: "platform-agents",
    listConfigMaps: async () => cms,
    getConfigMap: async () => null,
    createConfigMap: async (b) => b,
    replaceConfigMap: async (_n, b) => b,
    patchConfigMap: async () => undefined,
    deleteConfigMap: async () => undefined,
    listSecrets: async () => secrets,
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
}

describe("createGrantedConnectionsAdapter", () => {
  it("returns the granted owner connection joined to its K8s record", async () => {
    const client = fakeClient(
      [instanceCM("owner-1", "agent-1", "github-enterprise")],
      [
        connectionSecret(
          "owner-1",
          "github-enterprise",
          "github.example.com",
          "GitHub Enterprise (github.example.com)",
        ),
      ],
    );
    const adapter = createGrantedConnectionsAdapter(client);
    const got = await adapter("owner-1", "agent-1");

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: "github-enterprise",
      provider: "github-enterprise",
      metadata: {
        baseUrl: "github.example.com",
        displayName: "GitHub Enterprise (github.example.com)",
      },
    });
  });

  it("returns empty when the agent has no grants", async () => {
    const client = fakeClient(
      [instanceCM("owner-1", "agent-1", "")],
      [connectionSecret("owner-1", "github-enterprise", "github.example.com")],
    );
    const adapter = createGrantedConnectionsAdapter(client);
    expect(await adapter("owner-1", "agent-1")).toEqual([]);
  });

  it("drops connections the agent does not have granted", async () => {
    const client = fakeClient(
      [instanceCM("owner-1", "agent-1", "slack")],
      [connectionSecret("owner-1", "github-enterprise", "github.example.com")],
    );
    const adapter = createGrantedConnectionsAdapter(client);
    expect(await adapter("owner-1", "agent-1")).toEqual([]);
  });
});
