import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { agentTrpc } from "../../agents/agent-trpc.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { fileKeys } from "../api/keys.js";

export function useFileWatch(agentId: string | null, path: string | null) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);

  useEffect(() => {
    if (!agentId || !path || !operable) return;
    const subscription = agentTrpc(agentId).files.watchFile.subscribe(
      { path },
      {
        onData: (notice) => {
          if (notice.path !== path) return;
          void queryClient.invalidateQueries({
            queryKey: fileKeys.content(agentId, path),
          });
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [agentId, path, operable, queryClient]);
}
