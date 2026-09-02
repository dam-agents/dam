import { useQueryClient } from "@tanstack/react-query";
import { workspaceNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { fileKeys } from "../api/keys.js";
import { paramsForExpanded, useExpandedDirs } from "../api/queries.js";

export function useWorkspaceWatch(agentId: string | null) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  const expanded = useExpandedDirs(agentId);
  const paths = paramsForExpanded(expanded);
  const pathKey = JSON.stringify(paths);

  useEffect(() => {
    if (!agentId || !operable || compat) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).files.watch.subscribe(
        { paths: JSON.parse(pathKey) as string[] },
        {
          onData: (notice) => {
            if (!workspaceNoticeSchema.safeParse(notice).success) return;
            void queryClient.invalidateQueries({
              queryKey: fileKeys.tree(agentId),
            });
          },
          onError,
        },
      ),
    );
  }, [agentId, compat, operable, pathKey, queryClient]);
}
