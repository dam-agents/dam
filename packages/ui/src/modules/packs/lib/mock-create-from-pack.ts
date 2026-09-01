import { queryClient } from "../../../query-client.js";
import type { AgentView } from "../../../types.js";
import type { Pack } from "../data/packs.js";

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
  const listKey = [["agents", "list"], { type: "query" }];
  const existing =
    queryClient.getQueryData<{ list: AgentView[] }>(listKey)?.list ?? [];
  queryClient.setQueryData(listKey, { list: [agent, ...existing] });

  const withChannelsKey = [["agents", "listWithChannels"], { type: "query" }];
  const existingWc =
    queryClient.getQueryData<{ list: AgentView[] }>(withChannelsKey)?.list ??
    [];
  queryClient.setQueryData(withChannelsKey, {
    list: [agent, ...existingWc],
  });
}
