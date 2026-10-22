import { useQueryClient } from "@tanstack/react-query";
import { changesNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { changesKeys } from "../api/keys.js";

export function useChangesWatch(agentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);

  useEffect(() => {
    if (!enabled || !operable || compat || agentId === null) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).changes.watch.subscribe(undefined, {
        onData: (notice) => {
          if (!changesNoticeSchema.safeParse(notice).success) return;
          void queryClient.invalidateQueries({
            queryKey: changesKeys.agent(agentId),
          });
        },
        onError,
      }),
    );
  }, [agentId, compat, enabled, operable, queryClient]);
}
