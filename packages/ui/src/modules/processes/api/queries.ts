import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { agentTrpc, agentTrpcHttp } from "../../agents/agent-trpc.js";
import {
  agentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { processKeys } from "./keys.js";

const LIST_POLL_MS = 5_000;
const OUTPUT_POLL_MS = 3_000;

function clientFor(agentId: string) {
  return agentLacksLiveUpdates(agentId)
    ? agentTrpcHttp(agentId)
    : agentTrpc(agentId);
}

export function useProcesses(
  agentId: string | null,
  { enabled, poll }: { enabled: boolean; poll: boolean },
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: processKeys.list(agentId ?? "_none"),
    queryFn: () => clientFor(agentId!).processes.list.query(),
    enabled: enabled && !!agentId && operable,
    refetchInterval: poll ? LIST_POLL_MS : false,
    staleTime: 2_000,
  });
}

export function useProcessOutput(
  agentId: string | null,
  key: string,
  running: boolean,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: processKeys.output(agentId ?? "_none", key),
    queryFn: () => clientFor(agentId!).processes.output.query({ key }),
    enabled: !!agentId && operable,
    refetchInterval: running ? OUTPUT_POLL_MS : false,
    placeholderData: keepPreviousData,
    retry: 0,
  });
}
