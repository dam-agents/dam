import { skipToken, useQuery } from "@tanstack/react-query";

import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useAgentsList,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

const HARNESSES_WITH_OWN_SPEND = new Set(["bob"]);

function useReportsOwnSpend(agentId: string): boolean {
  const agent = useAgentsList().find((a) => a.id === agentId);
  const { data: templates } = useTemplates();
  const harness = templates?.find((t) => t.id === agent?.templateId)?.harness;
  return harness !== undefined && HARNESSES_WITH_OWN_SPEND.has(harness);
}

export function useHarnessSpend(agentId: string, from: string, to: string) {
  const operable = useIsAgentOperable(agentId);
  const lacksLiveUpdates = useAgentLacksLiveUpdates(agentId);
  const reportsOwnSpend = useReportsOwnSpend(agentId);
  const query = useQuery({
    queryKey: ["harness-spend", agentId, from, to],
    queryFn:
      operable && !lacksLiveUpdates
        ? () => agentTrpc(agentId).sessions.spend.query({ from, to })
        : skipToken,
    staleTime: 30_000,
    retry: false,
  });
  return { ...query, operable, reportsOwnSpend };
}
