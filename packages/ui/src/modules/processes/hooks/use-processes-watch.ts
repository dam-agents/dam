import { useQueryClient } from "@tanstack/react-query";
import { processNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { processKeys } from "../api/keys.js";

export function useProcessesWatch(agentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);

  useEffect(() => {
    if (!agentId || !enabled || !operable || compat) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).processes.watch.subscribe(undefined, {
        onData: (notice) => {
          if (!processNoticeSchema.safeParse(notice).success) return;
          void queryClient.invalidateQueries({
            queryKey: processKeys.agent(agentId),
          });
        },
        onError,
      }),
    );
  }, [agentId, compat, enabled, operable, queryClient]);
}
