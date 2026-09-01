import { useQueryClient } from "@tanstack/react-query";
import { fileContentNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { fileKeys } from "../api/keys.js";

export function useFileWatch(agentId: string | null, path: string | null) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);

  useEffect(() => {
    if (!agentId || !path || !operable || compat) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).files.watchFile.subscribe(
        { path },
        {
          onData: (notice) => {
            const parsed = fileContentNoticeSchema.safeParse(notice);
            if (!parsed.success || parsed.data.path !== path) return;
            void queryClient.invalidateQueries({
              queryKey: fileKeys.content(agentId, path),
            });
          },
          onError,
        },
      ),
    );
  }, [agentId, compat, path, operable, queryClient]);
}
