import { sessionNoticeSchema } from "agent-runtime-api";

import {
  useAgentLacksLiveUpdates,
  useAgentRunState,
} from "../../agents/api/queries.js";
import { useAgentWatch } from "../../agents/hooks/use-agent-watch.js";
import { acpSessionsKeys } from "../api/keys.js";

export function useSessionWatch(agentId: string | null) {
  const runState = useAgentRunState(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);

  useAgentWatch({
    agentId,
    enabled: runState === "running" && !compat,
    subscribe: (trpc, onData, onError) =>
      trpc.sessions.watch.subscribe(undefined, { onData, onError }),
    notice: sessionNoticeSchema,
    invalidate: (queryClient, id) =>
      void queryClient.invalidateQueries({
        queryKey: acpSessionsKeys.agent(id),
      }),
  });
}
