import { type ProcessList, processListSchema } from "agent-runtime-api";

import { agentTrpc, agentTrpcHttp } from "../../agents/agent-trpc.js";
import { agentLacksLiveUpdates } from "../../agents/api/queries.js";

export function processesClientFor(agentId: string) {
  return agentLacksLiveUpdates(agentId)
    ? agentTrpcHttp(agentId)
    : agentTrpc(agentId);
}

export async function fetchProcessList(agentId: string): Promise<ProcessList> {
  return processListSchema.parse(
    await processesClientFor(agentId).processes.list.query(),
  );
}
