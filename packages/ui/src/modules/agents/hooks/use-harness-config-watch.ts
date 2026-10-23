import { TRPCClientError } from "@trpc/client";
import { harnessConfigNoticeSchema } from "agent-runtime-api";

import { useAgentLiveUpdates, useAgentWatch } from "./use-agent-watch.js";

export function useHarnessConfigWatch(agentId: string | null) {
  useAgentWatch({
    agentId,
    enabled: useAgentLiveUpdates(agentId),
    subscribe: (trpc, onData, onError) =>
      trpc.harnessConfig.watch.subscribe(undefined, { onData, onError }),
    notice: harnessConfigNoticeSchema,
    invalidate: (queryClient, id) => {
      for (const key of [
        "provider-models",
        "harness-config-current",
        "harness-catalog-models",
      ])
        void queryClient.invalidateQueries({ queryKey: [key, id] });
    },
    retryOn: (error) =>
      !(error instanceof TRPCClientError && error.data?.code === "NOT_FOUND"),
  });
}
