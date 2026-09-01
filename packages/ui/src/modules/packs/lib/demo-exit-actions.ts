import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";

export function makeThisMine(packId: string): void {
  const store = useStore.getState();
  store.clearDemoAgent(packId);
  store.setSessionId(null);
  store.setMessages([]);
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
  for (const key of [
    [["agents", "list"], { type: "query" }],
    [["agents", "listWithChannels"], { type: "query" }],
  ]) {
    const data = queryClient.getQueryData<{ list: AgentView[] }>(key);
    if (data) {
      queryClient.setQueryData(key, {
        list: data.list.filter((a) => a.id !== agentId),
      });
    }
  }
}
