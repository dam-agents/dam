import type * as k8s from "@kubernetes/client-node";
import { type K8sClient } from "./k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_MANAGED_BY,
  LABEL_OWNER,
  LABEL_SECRET_TYPE,
  MANAGED_BY_API_SERVER,
  SECRET_TYPE_REGISTRY_PULL,
} from "./labels.js";

export interface RegistryCredential {
  server: string;
  username: string;
  password: string;
}

export interface AgentRegistrySecretPort {
  secretName(agentId: string): string;
  create(
    agentId: string,
    ownerSub: string,
    cred: RegistryCredential,
  ): Promise<void>;
  delete(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

function buildDockerConfigJson(cred: RegistryCredential): string {
  const auth = Buffer.from(`${cred.username}:${cred.password}`).toString(
    "base64",
  );
  return JSON.stringify({ auths: { [cred.server]: { auth } } });
}

export function createAgentRegistrySecretPort(
  client: K8sClient,
): AgentRegistrySecretPort {
  const secretName = (agentId: string) => `${agentId}-registry-pull`;

  return {
    secretName,

    async create(agentId, ownerSub, cred) {
      const body: k8s.V1Secret = {
        metadata: {
          name: secretName(agentId),
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_AGENT_REF]: agentId,
            [LABEL_SECRET_TYPE]: SECRET_TYPE_REGISTRY_PULL,
            [LABEL_MANAGED_BY]: MANAGED_BY_API_SERVER,
          },
        },
        type: "kubernetes.io/dockerconfigjson",
        stringData: { ".dockerconfigjson": buildDockerConfigJson(cred) },
      };
      await client.createSecret(body);
    },

    async delete(agentId) {
      await client.deleteSecret(secretName(agentId));
    },

    async listAgentIds() {
      const secrets = await client.listSecrets(
        `${LABEL_SECRET_TYPE}=${SECRET_TYPE_REGISTRY_PULL},${LABEL_MANAGED_BY}=${MANAGED_BY_API_SERVER}`,
      );
      const ids: string[] = [];
      for (const s of secrets) {
        const agentId = s.metadata?.labels?.[LABEL_AGENT_REF];
        if (agentId) ids.push(agentId);
      }
      return ids;
    },
  };
}
