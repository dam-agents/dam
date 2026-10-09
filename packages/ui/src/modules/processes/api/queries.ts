import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useIsAgentOperable } from "../../agents/api/queries.js";
import { processesClientFor } from "./client.js";
import { processKeys } from "./keys.js";

const LIST_POLL_MS = 5_000;
const OUTPUT_POLL_MS = 3_000;

export function useProcesses(
  agentId: string | null,
  { enabled, poll }: { enabled: boolean; poll: boolean },
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: processKeys.list(agentId ?? "_none"),
    queryFn: () => processesClientFor(agentId!).processes.list.query(),
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
    queryFn: () => processesClientFor(agentId!).processes.output.query({ key }),
    enabled: !!agentId && operable,
    refetchInterval: running ? OUTPUT_POLL_MS : false,
    placeholderData: keepPreviousData,
    retry: 0,
  });
}
