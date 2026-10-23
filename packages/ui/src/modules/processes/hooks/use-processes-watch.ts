import { processNoticeSchema } from "agent-runtime-api";

import {
  useAgentLiveUpdates,
  useAgentWatch,
} from "../../agents/hooks/use-agent-watch.js";
import { processKeys } from "../api/keys.js";

export function useProcessesWatch(agentId: string | null, enabled: boolean) {
  const live = useAgentLiveUpdates(agentId);

  useAgentWatch({
    agentId,
    enabled: enabled && live,
    subscribe: (trpc, onData, onError) =>
      trpc.processes.watch.subscribe(undefined, { onData, onError }),
    notice: processNoticeSchema,
    invalidate: (queryClient, id) =>
      void queryClient.invalidateQueries({ queryKey: processKeys.agent(id) }),
  });
}
