import { agentTrpc, agentTrpcHttp } from "../../agents/agent-trpc.js";
import { agentLacksLiveUpdates } from "../../agents/api/queries.js";

export function processesClientFor(agentId: string) {
  return agentLacksLiveUpdates(agentId)
    ? agentTrpcHttp(agentId)
    : agentTrpc(agentId);
}
