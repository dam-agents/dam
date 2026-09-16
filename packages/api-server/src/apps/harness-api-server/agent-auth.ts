import { agentKindSchema, type AgentKind } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  ANN_AGENT_KIND,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

export interface AgentIdentity {
  agentId: string;
  owner: string;
  uid: string;
  vmBackend: boolean;
  kind?: AgentKind;
  onboardingPending: boolean;
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
  const kindParse = agentKindSchema.safeParse(
    obj.metadata?.annotations?.[ANN_AGENT_KIND],
  );
  const annotations = obj.metadata?.annotations ?? {};
  return {
    agentId,
    owner,
    uid: obj.metadata?.uid ?? "",
    vmBackend: backend?.type === "vm",
    onboardingPending:
      annotations[ANN_STARTER_KIT] !== undefined &&
      annotations[ANN_STARTER_KIT_ONBOARDED] === undefined,
    ...(kindParse.success ? { kind: kindParse.data } : {}),
  };
}
