import { queryClient } from "../../../query-client.js";
import type { AgentView } from "../../../types.js";
import { agentsKeys } from "../../agents/api/queries.js";
import type { Pack } from "../data/packs.js";

function trpcAgentsListKey() {
  return [["agents", "list"], { input: undefined, type: "query" }];
}

export function mockCreateAgentFromPack(
  pack: Pack,
  name: string,
  templateId: string | null,
): string {
  const agentId = `pack-${pack.id}-${Date.now()}`;

  const agent: AgentView = {
    id: agentId,
    name,
    templateId,
    templateUpdate: null,
    image: templateId ? `ghcr.io/placeholder/${templateId}:latest` : "",
    description: pack.tagline,
    hibernationTimeoutMin: 60,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: true },
  };

  insertAgentIntoCache(agent);
  return agentId;
}

export function insertAgentIntoCache(agent: AgentView): void {
  const wcKey = agentsKeys.listWithChannels();
  const wcData = queryClient.getQueryData<{
    list: AgentView[];
    availableChannels?: unknown[];
  }>(wcKey);
  queryClient.setQueryData(wcKey, {
    list: [agent, ...(wcData?.list ?? [])],
    availableChannels: wcData?.availableChannels ?? [],
  });

  const trpcKey = trpcAgentsListKey();
  const trpcList = queryClient.getQueryData<AgentView[]>(trpcKey) ?? [];
  queryClient.setQueryData(trpcKey, [agent, ...trpcList]);
}
