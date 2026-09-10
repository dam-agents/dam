import { agentKindSchema, type AgentKind } from "api-server-api";
import type { AgentStore } from "../../modules/agents/infrastructure/agent-store.js";
import { ANN_AGENT_KIND } from "../../modules/agents/infrastructure/labels.js";

export interface AgentIdentity {
  agentId: string;
  owner: string;
  kind?: AgentKind;
}

export async function resolveAgent(
  store: AgentStore,
  agentId: string,
): Promise<AgentIdentity | null> {
  const record = await store.get(agentId);
  if (!record) return null;
  const kindParse = agentKindSchema.safeParse(
    record.annotations[ANN_AGENT_KIND],
  );
  return {
    agentId,
    owner: record.owner,
    ...(kindParse.success ? { kind: kindParse.data } : {}),
  };
}
