import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { PACKS } from "../data/packs.js";

function trpcAgentsListKey() {
  return [["agents", "list"], { input: undefined, type: "query" }];
}

export function makeThisMine(packId: string): void {
  const store = useStore.getState();
  store.clearDemoAgent(packId);

  const pack = PACKS.find((p) => p.id === packId);
  if (pack) {
    store.setPendingPack(pack);
    store.setView("agent-new");
  }
}

export function backToPacks(): void {
  const store = useStore.getState();
  store.resetChatContext();
  store.setView("packs");
}

export function walkAway(packId: string): void {
  const store = useStore.getState();
  const agentId = store.demoAgents.get(packId);

  if (agentId) {
    removeAgentFromCache(agentId);
  }

  store.clearDemoAgent(packId);
  store.resetChatContext();
  store.setView("packs");
}

function removeAgentFromCache(agentId: string): void {
  const wcKey = agentsKeys.listWithChannels();
  const wcData = queryClient.getQueryData<{
    list: AgentView[];
    availableChannels?: unknown[];
  }>(wcKey);
  if (wcData) {
    queryClient.setQueryData(wcKey, {
      ...wcData,
      list: wcData.list.filter((a) => a.id !== agentId),
    });
  }

  const trpcKey = trpcAgentsListKey();
  const trpcList = queryClient.getQueryData<AgentView[]>(trpcKey);
  if (trpcList) {
    queryClient.setQueryData(
      trpcKey,
      trpcList.filter((a) => a.id !== agentId),
    );
  }
}
