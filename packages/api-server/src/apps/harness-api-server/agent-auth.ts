import { agentKindSchema, type AgentKind } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  ANN_AGENT_KIND,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";
import { legacyShareRoots } from "../../modules/kb-shares/domain/legacy-roots.js";

export interface AgentIdentity {
  agentId: string;
  owner: string;
  kbShareRoots?: readonly string[];
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

  const annotations = obj.metadata?.annotations ?? {};
  const kindParse = agentKindSchema.safeParse(annotations[ANN_AGENT_KIND]);
  const shareRoots = shareRootsOf(
    annotations,
    kindParse.success ? kindParse.data : undefined,
  );
  return {
    agentId,
    owner,
    onboardingPending:
      annotations[ANN_STARTER_KIT] !== undefined &&
      annotations[ANN_STARTER_KIT_ONBOARDED] === undefined,
    ...(shareRoots ? { kbShareRoots: shareRoots } : {}),
  };
}

function shareRootsOf(
  annotations: Record<string, string>,
  kind: AgentKind | undefined,
): readonly string[] | undefined {
  const declared = (annotations[ANN_KB_SHARE_ROOTS] ?? "")
    .split(",")
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  if (declared.length > 0) return declared;
  if (kind !== "knowledge-base") return undefined;
  return legacyShareRoots(annotations[ANN_KB_TEMPLATE]);
}
