import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { agentTrpc } from "../../agents/agent-trpc.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { fileKeys } from "../api/keys.js";
import { paramsForExpanded, useExpandedDirs } from "../api/queries.js";

export function useWorkspaceWatch(agentId: string | null) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const expanded = useExpandedDirs(agentId);
  const paths = paramsForExpanded(expanded);
  const pathKey = paths.join("\n");

  useEffect(() => {
    if (!agentId || !operable) return;
    const subscription = agentTrpc(agentId).files.watch.subscribe(
      { paths: pathKey.split("\n") },
      {
        onData: () => {
          void queryClient.invalidateQueries({
            queryKey: fileKeys.tree(agentId),
          });
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [agentId, operable, pathKey, queryClient]);
}
