import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { harnessConfigNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../api/queries.js";

export function useHarnessConfigWatch(agentId: string | null) {
  const queryClient = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);

  useEffect(() => {
    if (!agentId || !operable || compat) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).harnessConfig.watch.subscribe(undefined, {
        onData: (notice) => {
          if (!harnessConfigNoticeSchema.safeParse(notice).success) return;
          for (const key of ["provider-models", "harness-config-current"])
            void queryClient.invalidateQueries({ queryKey: [key, agentId] });
        },
        onError: (error) => {
          const runtimePredatesWatch =
            error instanceof TRPCClientError &&
            error.data?.code === "NOT_FOUND";
          if (!runtimePredatesWatch) onError(error);
        },
      }),
    );
  }, [agentId, compat, operable, queryClient]);
}
