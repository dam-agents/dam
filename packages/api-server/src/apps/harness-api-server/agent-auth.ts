import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

export interface AgentIdentity {
  agentId: string;
  owner: string;
  uid: string;
  vmBackend: boolean;
}

export async function resolveAgent(
  k8s: K8sClient,
  agentId: string,
): Promise<AgentIdentity | null> {
  const obj = await k8s.getCustomObject(AGENTS_PLURAL, agentId);
  if (!obj) return null;
  const owner = obj.metadata?.labels?.[LABEL_OWNER];
  if (!owner) return null;

  const backend = (obj.spec as { backend?: { type?: string } } | undefined)
    ?.backend;
  return {
    agentId,
    owner,
    uid: obj.metadata?.uid ?? "",
    vmBackend: backend?.type === "vm",
  };
}
