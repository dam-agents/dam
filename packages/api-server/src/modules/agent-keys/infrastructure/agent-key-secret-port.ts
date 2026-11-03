import type * as k8s from "@kubernetes/client-node";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_MANAGED_BY,
  LABEL_OWNER,
  LABEL_SECRET_TYPE,
  MANAGED_BY_API_SERVER,
} from "../../agents/infrastructure/labels.js";
import {
  agentKeySds,
  agentKeySecretName,
  SECRET_TYPE_AGENT_KEY,
} from "../domain/agent-key.js";

const ANN_HOST_PATTERN = "agent-platform.ai/host-pattern";

export interface AgentKeySecretPort {
  write(
    agentId: string,
    ownerSub: string,
    host: string,
    key: string,
  ): Promise<void>;
  delete(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent Key Secret in the agent namespace,
 * labelled with its owner and Agent so the controller mounts it on that
 * Agent's gateway alone, with the environments domain the gateway sends the
 * key to. Its one file is the key as Envoy's credential injector reads it.
 */
export function createAgentKeySecretPort(
  client: K8sClient,
): AgentKeySecretPort {
  return {
    async write(agentId, ownerSub, host, key) {
      const name = agentKeySecretName(agentId);
      const body: k8s.V1Secret = {
        metadata: {
          name,
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_AGENT_REF]: agentId,
            [LABEL_SECRET_TYPE]: SECRET_TYPE_AGENT_KEY,
            [LABEL_MANAGED_BY]: MANAGED_BY_API_SERVER,
          },
          annotations: { [ANN_HOST_PATTERN]: host },
        },
        type: "Opaque",
        stringData: { "sds.yaml": agentKeySds(key) },
      };
      if (await client.getSecret(name)) await client.replaceSecret(name, body);
      else await client.createSecret(body);
    },

    async delete(agentId) {
      await client.deleteSecret(agentKeySecretName(agentId));
    },

    async listAgentIds() {
      const secrets = await client.listSecrets(
        `${LABEL_SECRET_TYPE}=${SECRET_TYPE_AGENT_KEY},${LABEL_MANAGED_BY}=${MANAGED_BY_API_SERVER}`,
      );
      return secrets.flatMap((s) => {
        const id = s.metadata?.labels?.[LABEL_AGENT_REF];
        return id ? [id] : [];
      });
    },
  };
}
