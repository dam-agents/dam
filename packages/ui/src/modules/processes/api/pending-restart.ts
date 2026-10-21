import type { PendingRestart } from "agent-runtime-api";

import { queryClient } from "../../../query-client.js";
import { fetchProcessList, processesClientFor } from "./client.js";
import { processKeys } from "./keys.js";

export async function readPendingRestart(
  agentId: string,
): Promise<PendingRestart | null> {
  const list = await queryClient.fetchQuery({
    queryKey: processKeys.list(agentId),
    queryFn: () => fetchProcessList(agentId),
    staleTime: 0,
    retry: false,
  });
  return list.pendingRestart;
}

export async function applyPendingRestart(agentId: string): Promise<void> {
  await processesClientFor(agentId).processes.applyPendingRestart.mutate();
}
