import { changesNoticeSchema } from "agent-runtime-api";

import {
  useAgentLiveUpdates,
  useAgentWatch,
} from "../../agents/hooks/use-agent-watch.js";
import { changesKeys } from "../api/keys.js";

export function useChangesWatch(agentId: string | null, enabled: boolean) {
  const live = useAgentLiveUpdates(agentId);

  useAgentWatch({
    agentId,
    enabled: enabled && live,
    subscribe: (trpc, onData, onError) =>
      trpc.changes.watch.subscribe(undefined, { onData, onError }),
    notice: changesNoticeSchema,
    invalidate: (queryClient, id) =>
      void queryClient.invalidateQueries({ queryKey: changesKeys.agent(id) }),
  });
}
